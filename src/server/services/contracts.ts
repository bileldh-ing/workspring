import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import {
  contractEvents,
  contracts,
  jobEvents,
  jobs,
  ledgerEntries,
  milestoneEvents,
  milestoneSubmissions,
  milestones,
  offerEvents,
  offers,
  paymentIntents,
  platformFeeRules,
  proposals,
  revisionRequests,
  users,
} from "@/db/schema";
import { AppError } from "@/domain/errors";
import { isCurrency, splitRelease, sumMinor, toMinor } from "@/domain/money";
import { type Actor, assertNotSelf, contractRole, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import {
  assertTransition,
  canFundInOrder,
  contractMachine,
  type MilestoneStatus,
  milestoneMachine,
  offerMachine,
} from "@/domain/state-machines";
import { deliverySchema, hourlyOfferSchema, offerSchema, parseOrThrow, revisionSchema } from "@/domain/validation";
import { getPaymentProvider, type PaymentProvider } from "../payments";
import { isUniqueViolation } from "./db-errors";
import { notify } from "./notifications";
import { createIntent, postTransaction, registerPaymentHandler } from "./payments";
import { moveProposal } from "./proposals";
import { assertNotBlocked } from "./safety";

export const OFFER_TTL_DAYS = 14;

// ---------------------------------------------------------------- offers

export async function createOffer(db: DB, actor: Actor, raw: unknown) {
  requireCapability(actor, "client");
  requireVerifiedEmail(actor);
  if (raw && typeof raw === "object" && "hourlyRate" in raw) return createHourlyOffer(db, actor, raw);
  const input = parseOrThrow(offerSchema, raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ p: proposals, job: jobs })
        .from(proposals)
        .innerJoin(jobs, eq(jobs.id, proposals.jobId))
        .where(eq(proposals.id, input.proposalId))
        .for("update", { of: proposals });
      if (!row || row.job.clientId !== actor.userId) throw new AppError("NOT_FOUND", "Proposal not found");
      assertNotSelf(actor.userId, row.p.freelancerId);
      if (row.job.status === "closed" || row.job.status === "draft") throw new AppError("CONFLICT", "This job is not open for hiring");
      if (row.job.contractType !== "fixed") throw new AppError("CONFLICT", "This is an hourly job: send an hourly offer instead");
      await assertNotBlocked(tx, actor.userId, row.p.freelancerId);
      if (!["submitted", "shortlisted"].includes(row.p.status)) {
        throw new AppError("INVALID_TRANSITION", `Can't send an offer on a ${row.p.status} proposal`);
      }
      const currency = row.job.currency;
      if (!isCurrency(currency)) throw new AppError("VALIDATION", "Unsupported currency");
      const ms = input.milestones.map((m, i) => ({ seq: i + 1, title: m.title, amountMinor: toMinor(m.amount, currency), dueDate: m.dueDate ?? null }));
      const totalMinor = sumMinor(ms.map((m) => m.amountMinor));
      const [fee] = await tx.select().from(platformFeeRules).where(eq(platformFeeRules.isActive, true)).orderBy(desc(platformFeeRules.version)).limit(1);
      if (!fee) throw new AppError("CONFLICT", "No active platform fee rule is configured");
      const expiresAt = new Date(Date.now() + OFFER_TTL_DAYS * 86400_000);
      const termsSnapshot = {
        parties: { clientId: actor.userId, freelancerId: row.p.freelancerId },
        title: input.title,
        description: input.description,
        contractType: "fixed",
        currency,
        totalMinor,
        milestones: ms,
        feeRule: { id: fee.id, version: fee.version, freelancerFeeBps: fee.freelancerFeeBps, clientFeeBps: fee.clientFeeBps },
        paymentMode: getPaymentProvider().mode,
        policies: { review: "Client approves or requests revisions on each submission", terms: "WorkSpring R1 draft terms v0 (not legal advice)" },
        expiresAt: expiresAt.toISOString(),
      };
      const [offer] = await tx
        .insert(offers)
        .values({
          proposalId: row.p.id,
          jobId: row.job.id,
          clientId: actor.userId,
          freelancerId: row.p.freelancerId,
          title: input.title,
          description: input.description,
          contractType: "fixed",
          currency,
          totalMinor,
          termsSnapshot,
          feeRuleId: fee.id,
          expiresAt,
        })
        .returning();
      await tx.insert(offerEvents).values({ offerId: offer.id, actorId: actor.userId, fromStatus: null, toStatus: "sent" });
      await moveProposal(tx, row.p.id, row.p.status, "offer_sent", actor.userId);
      await notifyOffer(tx, offer);
      return offer;
    });
  } catch (e) {
    if (isUniqueViolation(e, "offers_one_open_per_proposal_uq")) throw new AppError("CONFLICT", "An offer is already pending for this proposal");
    throw e;
  }
}

async function notifyOffer(tx: Executor, offer: typeof offers.$inferSelect) {
  await notify(tx, { userId: offer.freelancerId, category: "contracts", kind: "offer.received", title: `New offer: ${offer.title}`, body: "Review the terms and accept or decline.", link: `/app/offers/${offer.id}`, dedupeKey: `offer.received:${offer.id}` });
}

/** Hourly offer: agreed rate, weekly limit (cap on billable hours) and whether manual time is allowed. */
async function createHourlyOffer(db: DB, actor: Actor, raw: unknown) {
  const input = parseOrThrow(hourlyOfferSchema, raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ p: proposals, job: jobs })
        .from(proposals)
        .innerJoin(jobs, eq(jobs.id, proposals.jobId))
        .where(eq(proposals.id, input.proposalId))
        .for("update", { of: proposals });
      if (!row || row.job.clientId !== actor.userId) throw new AppError("NOT_FOUND", "Proposal not found");
      assertNotSelf(actor.userId, row.p.freelancerId);
      if (row.job.status === "closed" || row.job.status === "draft") throw new AppError("CONFLICT", "This job is not open for hiring");
      if (row.job.contractType !== "hourly") throw new AppError("CONFLICT", "This is a fixed-price job: send a milestone offer instead");
      if (!["submitted", "shortlisted"].includes(row.p.status)) throw new AppError("INVALID_TRANSITION", `Can't send an offer on a ${row.p.status} proposal`);
      await assertNotBlocked(tx, actor.userId, row.p.freelancerId);
      const currency = row.job.currency;
      if (!isCurrency(currency)) throw new AppError("VALIDATION", "Unsupported currency");
      const hourlyRateMinor = toMinor(input.hourlyRate, currency);
      const weeklyLimitMinutes = input.weeklyLimitHours * 60;
      const totalMinor = hourlyRateMinor * input.weeklyLimitHours; // maximum billable per week
      const [fee] = await tx.select().from(platformFeeRules).where(eq(platformFeeRules.isActive, true)).orderBy(desc(platformFeeRules.version)).limit(1);
      if (!fee) throw new AppError("CONFLICT", "No active platform fee rule is configured");
      const expiresAt = new Date(Date.now() + OFFER_TTL_DAYS * 86400_000);
      const termsSnapshot = {
        parties: { clientId: actor.userId, freelancerId: row.p.freelancerId },
        title: input.title,
        description: input.description,
        contractType: "hourly",
        currency,
        hourlyRateMinor,
        weeklyLimitMinutes,
        allowManualTime: input.allowManualTime,
        maxWeeklyMinor: totalMinor,
        feeRule: { id: fee.id, version: fee.version, freelancerFeeBps: fee.freelancerFeeBps, clientFeeBps: fee.clientFeeBps },
        paymentMode: getPaymentProvider().mode,
        policies: {
          timesheets: "Weekly timesheets (Mon–Sun, UTC). Client approves or disputes each submitted week; approved weeks are paid through the payment provider.",
          tracking: "Web timer records start/stop only while the freelancer runs it. No screenshots, keystrokes or activity monitoring.",
          manualTime: input.allowManualTime ? "Manual entries allowed and labelled as manual." : "Manual entries not allowed.",
          terms: "WorkSpring draft terms v0 (not legal advice)",
        },
        expiresAt: expiresAt.toISOString(),
      };
      const [offer] = await tx
        .insert(offers)
        .values({ proposalId: row.p.id, jobId: row.job.id, clientId: actor.userId, freelancerId: row.p.freelancerId, title: input.title, description: input.description, contractType: "hourly", currency, totalMinor, hourlyRateMinor, weeklyLimitMinutes, allowManualTime: input.allowManualTime, termsSnapshot, feeRuleId: fee.id, expiresAt })
        .returning();
      await tx.insert(offerEvents).values({ offerId: offer.id, actorId: actor.userId, fromStatus: null, toStatus: "sent" });
      await moveProposal(tx, row.p.id, row.p.status, "offer_sent", actor.userId);
      await notifyOffer(tx, offer);
      return offer;
    });
  } catch (e) {
    if (isUniqueViolation(e, "offers_one_open_per_proposal_uq")) throw new AppError("CONFLICT", "An offer is already pending for this proposal");
    throw e;
  }
}

export async function getOffer(db: Executor, actor: Actor, offerId: string) {
  const [row] = await db
    .select({ o: offers, clientName: users.displayName })
    .from(offers)
    .innerJoin(users, eq(users.id, offers.clientId))
    .where(eq(offers.id, offerId));
  if (!row || (row.o.clientId !== actor.userId && row.o.freelancerId !== actor.userId)) throw new AppError("NOT_FOUND", "Offer not found");
  const [freelancer] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.o.freelancerId));
  const events = await db.select().from(offerEvents).where(eq(offerEvents.offerId, offerId)).orderBy(desc(offerEvents.createdAt));
  const [contract] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.offerId, offerId));
  const effectiveStatus = row.o.status === "sent" && row.o.expiresAt < new Date() ? "expired" : row.o.status;
  return { ...row.o, effectiveStatus, clientName: row.clientName, freelancerName: freelancer?.displayName ?? "", events, contractId: contract?.id ?? null, viewerRole: actor.userId === row.o.clientId ? ("client" as const) : ("freelancer" as const) };
}

export async function listMyOffers(db: Executor, actor: Actor) {
  return db
    .select()
    .from(offers)
    .where(or(eq(offers.freelancerId, actor.userId), eq(offers.clientId, actor.userId)))
    .orderBy(desc(offers.createdAt));
}

async function lockOffer(tx: Executor, offerId: string) {
  const [o] = await tx.select().from(offers).where(eq(offers.id, offerId)).for("update");
  return o ?? null;
}

async function setOfferStatus(tx: Executor, offer: typeof offers.$inferSelect, to: "accepted" | "declined" | "withdrawn" | "expired", actorId: string | null) {
  assertTransition(offerMachine, offer.status, to, "offer");
  await tx.update(offers).set({ status: to, respondedAt: new Date() }).where(eq(offers.id, offer.id));
  await tx.insert(offerEvents).values({ offerId: offer.id, actorId, fromStatus: offer.status, toStatus: to });
}

/**
 * Freelancer accepts an offer. One transaction, row locks on the job and the offer, and partial unique
 * indexes (contracts_offer_uq, contracts_one_live_per_job_uq) guarantee a single live contract even under races.
 */
export async function acceptOffer(db: DB, actor: Actor, offerId: string) {
  requireCapability(actor, "freelancer");
  try {
    return await db.transaction(async (tx) => {
      const peek = (await tx.select({ jobId: offers.jobId, freelancerId: offers.freelancerId }).from(offers).where(eq(offers.id, offerId)))[0];
      if (!peek || peek.freelancerId !== actor.userId) throw new AppError("NOT_FOUND", "Offer not found");
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, peek.jobId)).for("update"); // serialize hires per job
      const offer = (await lockOffer(tx, offerId))!;
      if (offer.status === "sent" && offer.expiresAt < new Date()) {
        // Expiry is recorded by its own small transaction after this one rolls back.
        throw new AppError("INVALID_TRANSITION", "This offer has expired");
      }
      assertTransition(offerMachine, offer.status, "accepted", "offer");
      if (job.status === "closed") throw new AppError("CONFLICT", "This job is closed");
      const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, offer.proposalId)).for("update");
      if (proposal.status !== "offer_sent") throw new AppError("INVALID_TRANSITION", `Proposal is ${proposal.status}; the offer can no longer be accepted`);

      await setOfferStatus(tx, offer, "accepted", actor.userId);
      const snap = offer.termsSnapshot as { milestones?: { seq: number; title: string; amountMinor: number; dueDate: string | null }[]; feeRule: Record<string, unknown> };
      const [contract] = await tx
        .insert(contracts)
        .values({
          offerId: offer.id,
          jobId: offer.jobId,
          clientId: offer.clientId,
          freelancerId: offer.freelancerId,
          title: offer.title,
          contractType: offer.contractType,
          currency: offer.currency,
          totalMinor: offer.totalMinor,
          termsSnapshot: offer.termsSnapshot,
          feeRuleSnapshot: snap.feeRule,
          hourlyRateMinor: offer.hourlyRateMinor,
          weeklyLimitMinutes: offer.weeklyLimitMinutes,
          allowManualTime: offer.allowManualTime,
        })
        .returning();
      if (offer.contractType === "fixed" && snap.milestones?.length) {
        const ms = await tx
          .insert(milestones)
          .values(snap.milestones.map((m) => ({ contractId: contract.id, seq: m.seq, title: m.title, amountMinor: m.amountMinor, currency: offer.currency, dueDate: m.dueDate })))
          .returning();
        await tx.insert(milestoneEvents).values(ms.map((m) => ({ milestoneId: m.id, actorId: actor.userId, fromStatus: null, toStatus: "unfunded" })));
      }
      await notify(tx, { userId: offer.clientId, category: "contracts", kind: "offer.accepted", title: `Offer accepted: ${offer.title}`, body: "The contract has started.", link: `/app/contracts/${contract.id}`, dedupeKey: `offer.accepted:${offer.id}` });
      await tx.insert(contractEvents).values({ contractId: contract.id, actorId: actor.userId, kind: "contract.started", data: { offerId: offer.id } });
      await moveProposal(tx, proposal.id, "offer_sent", "hired", actor.userId);
      // R1 jobs hire one freelancer: close the job and record who triggered it.
      {
        await tx.update(jobs).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id));
        await tx.insert(jobEvents).values({ jobId: job.id, actorId: actor.userId, fromStatus: job.status, toStatus: "closed" });
      }
      return contract;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "This job already has an active contract");
    if (e instanceof AppError && e.message === "This offer has expired") await expireOffer(db, offerId);
    throw e;
  }
}

async function expireOffer(db: DB, offerId: string) {
  await db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    if (!o || o.status !== "sent" || o.expiresAt >= new Date()) return;
    await setOfferStatus(tx, o, "expired", null);
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, o.proposalId)).for("update");
    if (p?.status === "offer_sent") await moveProposal(tx, p.id, "offer_sent", "shortlisted", null, "offer expired");
  });
}

export async function declineOffer(db: DB, actor: Actor, offerId: string) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    if (!o || o.freelancerId !== actor.userId) throw new AppError("NOT_FOUND", "Offer not found");
    await setOfferStatus(tx, o, "declined", actor.userId);
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, o.proposalId)).for("update");
    // Declining an offer also withdraws the proposal.
    if (p.status === "offer_sent") await moveProposal(tx, p.id, "offer_sent", "withdrawn", actor.userId, "offer declined");
  });
}

export async function withdrawOffer(db: DB, actor: Actor, offerId: string) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    if (!o || o.clientId !== actor.userId) throw new AppError("NOT_FOUND", "Offer not found");
    await setOfferStatus(tx, o, "withdrawn", actor.userId);
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, o.proposalId)).for("update");
    if (p.status === "offer_sent") await moveProposal(tx, p.id, "offer_sent", "shortlisted", actor.userId, "offer withdrawn");
  });
}

// ---------------------------------------------------------------- contracts & milestones

export async function listMyContracts(db: Executor, actor: Actor) {
  return db
    .select()
    .from(contracts)
    .where(or(eq(contracts.clientId, actor.userId), eq(contracts.freelancerId, actor.userId)))
    .orderBy(desc(contracts.startedAt));
}

async function loadContractFor(db: Executor, actor: Actor, contractId: string) {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  const role = c ? contractRole(actor, c) : null;
  if (!c || !role) throw new AppError("NOT_FOUND", "Contract not found");
  return { contract: c, role };
}

export async function getWorkroom(db: Executor, actor: Actor, contractId: string) {
  const { contract, role } = await loadContractFor(db, actor, contractId);
  const ms = await db.select().from(milestones).where(eq(milestones.contractId, contractId)).orderBy(asc(milestones.seq));
  const ids = ms.map((m) => m.id);
  const [subs, revs, mEvents, intents, ledger, cEvents, people] = await Promise.all([
    ids.length ? db.select().from(milestoneSubmissions).where(inArray(milestoneSubmissions.milestoneId, ids)).orderBy(asc(milestoneSubmissions.version)) : [],
    ids.length ? db.select().from(revisionRequests).where(inArray(revisionRequests.milestoneId, ids)).orderBy(asc(revisionRequests.createdAt)) : [],
    ids.length ? db.select().from(milestoneEvents).where(inArray(milestoneEvents.milestoneId, ids)).orderBy(desc(milestoneEvents.createdAt)) : [],
    ids.length ? db.select().from(paymentIntents).where(inArray(paymentIntents.milestoneId, ids)).orderBy(desc(paymentIntents.createdAt)) : [],
    db.select().from(ledgerEntries).where(eq(ledgerEntries.contractId, contractId)).orderBy(asc(ledgerEntries.createdAt)),
    db.select().from(contractEvents).where(eq(contractEvents.contractId, contractId)).orderBy(desc(contractEvents.createdAt)),
    db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, [contract.clientId, contract.freelancerId])),
  ]);
  const name = (id: string | null) => people.find((p) => p.id === id)?.displayName ?? (id ? "Unknown" : "System");
  return {
    contract,
    role,
    clientName: name(contract.clientId),
    freelancerName: name(contract.freelancerId),
    milestones: ms.map((m) => ({
      ...m,
      submissions: subs.filter((s) => s.milestoneId === m.id),
      revisions: revs.filter((r) => r.milestoneId === m.id),
      events: mEvents.filter((e) => e.milestoneId === m.id).map((e) => ({ ...e, actorName: e.actorKind === "user" ? name(e.actorId) : e.actorKind })),
      intents: intents.filter((i) => i.milestoneId === m.id),
    })),
    ledger,
    events: cEvents,
  };
}

async function lockMilestone(tx: Executor, actor: Actor, milestoneId: string) {
  const [row] = await tx
    .select({ m: milestones, c: contracts })
    .from(milestones)
    .innerJoin(contracts, eq(contracts.id, milestones.contractId))
    .where(eq(milestones.id, milestoneId))
    .for("update", { of: milestones });
  const role = row ? contractRole(actor, row.c) : null;
  if (!row || !role) throw new AppError("NOT_FOUND", "Milestone not found");
  if (row.m.status === "disputed" || row.m.status === "refund_pending") throw new AppError("INVALID_TRANSITION", "This milestone is on hold while a dispute is reviewed");
  return { ...row, role };
}

export async function moveMilestone(
  tx: Executor,
  m: typeof milestones.$inferSelect,
  to: MilestoneStatus,
  actor: { id: string | null; kind: "user" | "provider_webhook" | "system" },
  data?: Record<string, unknown>,
) {
  assertTransition(milestoneMachine, m.status, to, "milestone");
  const stamp = to === "funded" ? { fundedAt: new Date() } : to === "approved" ? { approvedAt: new Date() } : to === "released" ? { releasedAt: new Date() } : {};
  await tx.update(milestones).set({ status: to, updatedAt: new Date(), ...stamp }).where(eq(milestones.id, m.id));
  await tx.insert(milestoneEvents).values({ milestoneId: m.id, actorId: actor.id, actorKind: actor.kind, fromStatus: m.status, toStatus: to, data: data ?? null });
}

function assertContractLive(c: typeof contracts.$inferSelect) {
  if (c.status !== "active") throw new AppError("INVALID_TRANSITION", `Contract is ${c.status}`);
}

/**
 * Client starts funding a milestone. This creates a provider payment and moves the milestone to
 * funding_pending. It becomes "funded" ONLY when a verified provider webhook says the payment succeeded.
 */
export async function fundMilestone(db: DB, actor: Actor, milestoneId: string, provider: PaymentProvider = getPaymentProvider()) {
  if (!provider.configured) throw new AppError("PROVIDER_UNCONFIGURED", provider.unavailableReason ?? "Payments are not configured");
  return db.transaction(async (tx) => {
    const { m, c, role } = await lockMilestone(tx, actor, milestoneId);
    if (role !== "client") throw new AppError("FORBIDDEN", "Only the client can fund milestones");
    assertContractLive(c);
    if (m.status === "funding_pending") {
      // Idempotent re-entry: hand back the existing pending checkout instead of charging twice.
      const [existing] = await tx
        .select()
        .from(paymentIntents)
        .where(and(eq(paymentIntents.milestoneId, m.id), eq(paymentIntents.purpose, "milestone_funding"), eq(paymentIntents.status, "requires_action")));
      if (existing) return { intentId: existing.id, actionUrl: provider.mode === "test" ? `/test-provider/checkout/${existing.id}` : null };
    }
    const siblings = await tx.select({ seq: milestones.seq, status: milestones.status }).from(milestones).where(eq(milestones.contractId, c.id));
    if (!canFundInOrder(m, siblings)) throw new AppError("INVALID_TRANSITION", "Fund earlier milestones first");
    assertTransition(milestoneMachine, m.status, "funding_pending", "milestone");
    const { intentId, actionUrl } = await createIntent(tx, provider, { purpose: "milestone_funding", target: { milestoneId: m.id }, amountMinor: m.amountMinor, currency: m.currency, description: `Milestone ${m.seq}: ${m.title}`, createdBy: actor.userId });
    await moveMilestone(tx, m, "funding_pending", { id: actor.userId, kind: "user" }, { intentId, provider: provider.id, mode: provider.mode });
    return { intentId, actionUrl };
  });
}

export async function deliverMilestone(db: DB, actor: Actor, milestoneId: string, raw: unknown) {
  const input = parseOrThrow(deliverySchema, raw);
  return db.transaction(async (tx) => {
    const { m, c, role } = await lockMilestone(tx, actor, milestoneId);
    if (role !== "freelancer") throw new AppError("FORBIDDEN", "Only the freelancer can submit work");
    assertContractLive(c);
    assertTransition(milestoneMachine, m.status, "submitted", "milestone");
    const [{ v }] = await tx.execute<{ v: number }>(
      sql`select coalesce(max(version), 0)::int + 1 as v from milestone_submissions where milestone_id = ${m.id}`,
    );
    const [sub] = await tx.insert(milestoneSubmissions).values({ milestoneId: m.id, version: Number(v), note: input.note, submittedBy: actor.userId }).returning();
    await moveMilestone(tx, m, "submitted", { id: actor.userId, kind: "user" }, { submissionId: sub.id, version: sub.version });
    await notify(tx, { userId: c.clientId, category: "contracts", kind: "milestone.submitted", title: `Work submitted: ${m.title}`, body: "Review it and approve or request changes.", link: `/app/contracts/${c.id}`, dedupeKey: `milestone.submitted:${sub.id}` });
    return sub;
  });
}

export async function requestRevision(db: DB, actor: Actor, milestoneId: string, raw: unknown) {
  const input = parseOrThrow(revisionSchema, raw);
  return db.transaction(async (tx) => {
    const { m, c, role } = await lockMilestone(tx, actor, milestoneId);
    if (role !== "client") throw new AppError("FORBIDDEN", "Only the client can request revisions");
    assertContractLive(c);
    assertTransition(milestoneMachine, m.status, "revision_requested", "milestone");
    const [latest] = await tx.select().from(milestoneSubmissions).where(eq(milestoneSubmissions.milestoneId, m.id)).orderBy(desc(milestoneSubmissions.version)).limit(1);
    await tx.insert(revisionRequests).values({ milestoneId: m.id, submissionId: latest.id, note: input.note, requestedBy: actor.userId });
    await moveMilestone(tx, m, "revision_requested", { id: actor.userId, kind: "user" }, { submissionVersion: latest.version });
    await notify(tx, { userId: c.freelancerId, category: "contracts", kind: "milestone.revision", title: `Changes requested: ${m.title}`, body: input.note.slice(0, 200), link: `/app/contracts/${c.id}`, dedupeKey: `milestone.revision:${m.id}:${latest.version}` });
  });
}

/**
 * Client approves submitted work. Approval immediately requests a provider transfer (release);
 * the milestone shows "release_pending" until a verified webhook confirms the transfer.
 */
export async function approveMilestone(db: DB, actor: Actor, milestoneId: string, provider: PaymentProvider = getPaymentProvider()) {
  await db.transaction(async (tx) => {
    const { m, c, role } = await lockMilestone(tx, actor, milestoneId);
    if (role !== "client") throw new AppError("FORBIDDEN", "Only the client can approve work");
    assertContractLive(c);
    await moveMilestone(tx, m, "approved", { id: actor.userId, kind: "user" });
  });
  return requestRelease(db, actor, milestoneId, provider);
}

/** Requests (or retries after a provider failure) the transfer for an approved milestone. */
export async function requestRelease(db: DB, actor: Actor, milestoneId: string, provider: PaymentProvider = getPaymentProvider()) {
  if (!provider.configured) throw new AppError("PROVIDER_UNCONFIGURED", provider.unavailableReason ?? "Payments are not configured");
  return db.transaction(async (tx) => {
    const { m, c, role } = await lockMilestone(tx, actor, milestoneId);
    if (role !== "client") throw new AppError("FORBIDDEN", "Only the client can release payment");
    assertTransition(milestoneMachine, m.status, "release_pending", "milestone");
    const fee = c.feeRuleSnapshot as { freelancerFeeBps: number };
    const split = splitRelease(m.amountMinor, fee.freelancerFeeBps);
    const { intentId } = await createIntent(tx, provider, { purpose: "milestone_release", target: { milestoneId: m.id }, amountMinor: m.amountMinor, feeMinor: split.feeMinor, currency: m.currency, description: `Release milestone ${m.seq}`, createdBy: actor.userId });
    await moveMilestone(tx, m, "release_pending", { id: actor.userId, kind: "user" }, { intentId, ...split });
    return { intentId, ...split };
  });
}

export async function completeContractIfDone(tx: Executor, contractId: string) {
  const ms = await tx.select({ status: milestones.status }).from(milestones).where(eq(milestones.contractId, contractId));
  const live = ms.filter((m) => m.status !== "canceled");
  if (live.length === 0 || !live.every((m) => m.status === "released" || m.status === "refunded")) return false;
  const [c] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).for("update");
  if (c.status !== "active") return false;
  assertTransition(contractMachine, c.status, "completed", "contract");
  await tx.update(contracts).set({ status: "completed", endedAt: new Date() }).where(eq(contracts.id, contractId));
  await tx.insert(contractEvents).values({ contractId, actorId: null, kind: "contract.completed", data: { reason: "all milestones released" } });
  return true;
}

// ---------------------------------------------------------------- provider outcomes (registered with payments)

registerPaymentHandler("milestone_funding", async (tx, intent, succeeded, event) => {
  const [m] = await tx.select().from(milestones).where(eq(milestones.id, intent.milestoneId!)).for("update");
  const [c] = await tx.select().from(contracts).where(eq(contracts.id, m.contractId));
  const actor = { id: null, kind: "provider_webhook" as const };
  if (succeeded) {
    await moveMilestone(tx, m, "funded", actor, { eventId: event.id, intentId: intent.id });
    await postTransaction(tx, { mode: intent.mode, currency: intent.currency, contractId: c.id, milestoneId: m.id, paymentIntentId: intent.id, memo: `Milestone ${m.seq} funded (${intent.mode})` }, [
      { account: "provider_balance", direction: "debit", amountMinor: intent.amountMinor },
      { account: "milestone_payable", direction: "credit", amountMinor: intent.amountMinor },
    ]);
    await notify(tx, { userId: c.freelancerId, category: "payments", kind: "milestone.funded", title: `Milestone funded: ${m.title}`, body: intent.mode === "test" ? "TEST MODE: no real money moved." : undefined, link: `/app/contracts/${c.id}`, dedupeKey: `milestone.funded:${intent.id}` });
  } else {
    await moveMilestone(tx, m, "unfunded", actor, { eventId: event.id, reason: event.failureReason ?? null });
    await notify(tx, { userId: c.clientId, category: "payments", kind: "milestone.funding_failed", title: `Funding failed: ${m.title}`, body: event.failureReason, link: `/app/contracts/${c.id}`, dedupeKey: `milestone.funding_failed:${intent.id}` });
  }
});

registerPaymentHandler("milestone_release", async (tx, intent, succeeded, event) => {
  const [m] = await tx.select().from(milestones).where(eq(milestones.id, intent.milestoneId!)).for("update");
  const [c] = await tx.select().from(contracts).where(eq(contracts.id, m.contractId));
  const actor = { id: null, kind: "provider_webhook" as const };
  if (succeeded) {
    await moveMilestone(tx, m, "released", actor, { eventId: event.id, intentId: intent.id });
    await postTransaction(tx, { mode: intent.mode, currency: intent.currency, contractId: c.id, milestoneId: m.id, paymentIntentId: intent.id, memo: `Milestone ${m.seq} released (${intent.mode})` }, [
      { account: "milestone_payable", direction: "debit", amountMinor: intent.amountMinor },
      { account: "provider_balance", direction: "credit", amountMinor: intent.amountMinor - intent.feeMinor },
      { account: "platform_fee_revenue", direction: "credit", amountMinor: intent.feeMinor },
    ]);
    await notify(tx, { userId: c.freelancerId, category: "payments", kind: "milestone.released", title: `Payment released: ${m.title}`, body: intent.mode === "test" ? "TEST MODE: no real money moved." : undefined, link: `/app/contracts/${c.id}`, dedupeKey: `milestone.released:${intent.id}` });
    await completeContractIfDone(tx, c.id);
  } else {
    await moveMilestone(tx, m, "approved", actor, { eventId: event.id, reason: event.failureReason ?? null });
  }
});
