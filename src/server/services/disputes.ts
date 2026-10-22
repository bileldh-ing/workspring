import { and, desc, eq } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { contracts, disputeEvents, disputes, milestones, paymentIntents, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { type Actor, contractRole } from "@/domain/permissions";
import { assertTransition, type DisputeStatus, disputeMachine, type MilestoneStatus } from "@/domain/state-machines";
import { disputeSchema, parseOrThrow, resolutionSchema } from "@/domain/validation";
import { getPaymentProvider, type PaymentProvider } from "../payments";
import { requireStaff } from "./admin";
import { audit } from "./audit";
import { completeContractIfDone, moveMilestone } from "./contracts";
import { isUniqueViolation } from "./db-errors";
import { notify } from "./notifications";
import { createIntent, postTransaction, registerPaymentHandler } from "./payments";

const DISPUTABLE: MilestoneStatus[] = ["funded", "submitted", "revision_requested"];

async function moveDispute(tx: Executor, d: typeof disputes.$inferSelect, to: DisputeStatus, actorId: string | null, note?: string) {
  assertTransition(disputeMachine, d.status, to, "dispute");
  const final = to !== "under_review";
  await tx
    .update(disputes)
    .set({ status: to, ...(final ? { resolvedAt: new Date(), resolvedBy: actorId, resolutionNote: note ?? null } : {}) })
    .where(eq(disputes.id, d.id));
  await tx.insert(disputeEvents).values({ disputeId: d.id, actorId, fromStatus: d.status, toStatus: to, note: note ?? null });
}

/**
 * Either party disputes a FUNDED milestone (funded / submitted / revision requested). The milestone is frozen
 * until staff resolve it. WorkSpring's internal decision does not override provider or bank rights (see PAYMENTS doc).
 */
export async function openDispute(db: DB, actor: Actor, raw: unknown) {
  const input = parseOrThrow(disputeSchema, raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ m: milestones, c: contracts })
        .from(milestones)
        .innerJoin(contracts, eq(contracts.id, milestones.contractId))
        .where(eq(milestones.id, input.milestoneId))
        .for("update", { of: milestones });
      const role = row ? contractRole(actor, row.c) : null;
      if (!row || !role) throw new AppError("NOT_FOUND", "Milestone not found");
      if (!DISPUTABLE.includes(row.m.status)) throw new AppError("INVALID_TRANSITION", "Only funded milestones that haven't been approved can be disputed");
      const [d] = await tx.insert(disputes).values({ milestoneId: row.m.id, contractId: row.c.id, openedBy: actor.userId, reason: input.reason, priorMilestoneStatus: row.m.status }).returning();
      await tx.insert(disputeEvents).values({ disputeId: d.id, actorId: actor.userId, fromStatus: null, toStatus: "open", note: input.reason.slice(0, 500) });
      await moveMilestone(tx, row.m, "disputed", { id: actor.userId, kind: "user" }, { disputeId: d.id });
      const other = role === "client" ? row.c.freelancerId : row.c.clientId;
      await notify(tx, { userId: other, category: "payments", kind: "dispute.opened", title: `Dispute opened on "${row.m.title}"`, body: "The milestone is on hold while WorkSpring support reviews it.", link: `/app/contracts/${row.c.id}`, dedupeKey: `dispute.opened:${d.id}` });
      return d;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "A dispute is already open for this milestone");
    throw e;
  }
}

/** The party who opened it can withdraw; the milestone returns to where it was. */
export async function withdrawDispute(db: DB, actor: Actor, disputeId: string) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for("update");
    if (!d || d.openedBy !== actor.userId) throw new AppError("NOT_FOUND", "Dispute not found");
    const [m] = await tx.select().from(milestones).where(eq(milestones.id, d.milestoneId)).for("update");
    await moveDispute(tx, d, "withdrawn", actor.userId, "withdrawn by the party who opened it");
    await moveMilestone(tx, m, d.priorMilestoneStatus as MilestoneStatus, { id: actor.userId, kind: "user" }, { disputeId: d.id, outcome: "withdrawn" });
  });
}

export async function disputesForContract(db: Executor, actor: Actor, contractId: string) {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!c || !contractRole(actor, c)) throw new AppError("NOT_FOUND", "Contract not found");
  return db.select().from(disputes).where(eq(disputes.contractId, contractId)).orderBy(desc(disputes.createdAt));
}

export async function listDisputesForStaff(db: Executor, actor: Actor) {
  await requireStaff(db, actor, "disputes.resolve");
  return db
    .select({ d: disputes, milestoneTitle: milestones.title, amountMinor: milestones.amountMinor, currency: milestones.currency, milestoneStatus: milestones.status, contractTitle: contracts.title, openedByName: users.displayName })
    .from(disputes)
    .innerJoin(milestones, eq(milestones.id, disputes.milestoneId))
    .innerJoin(contracts, eq(contracts.id, disputes.contractId))
    .innerJoin(users, eq(users.id, disputes.openedBy))
    .orderBy(desc(disputes.createdAt))
    .limit(100);
}

/**
 * Staff resolution (disputes.resolve), always audited:
 *  - release: milestone → approved, then the client's normal release (provider transfer) pays the freelancer;
 *  - refund: milestone → refund_pending + provider refund; "refunded" ONLY on a verified webhook.
 */
export async function resolveDispute(db: DB, actor: Actor, disputeId: string, outcome: "release" | "refund", raw: unknown, provider: PaymentProvider = getPaymentProvider()) {
  await requireStaff(db, actor, "disputes.resolve");
  const { note } = parseOrThrow(resolutionSchema, raw);
  if (!provider.configured) throw new AppError("PROVIDER_UNCONFIGURED", provider.unavailableReason ?? "Payments are not configured");
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for("update");
    if (!d) throw new AppError("NOT_FOUND", "Dispute not found");
    const [m] = await tx.select().from(milestones).where(eq(milestones.id, d.milestoneId)).for("update");
    const [c] = await tx.select().from(contracts).where(eq(contracts.id, d.contractId));
    const staff = { id: actor.userId, kind: "user" as const };
    let intentId: string | null = null;
    if (outcome === "release") {
      await moveDispute(tx, d, "resolved_release", actor.userId, note);
      await moveMilestone(tx, m, "approved", staff, { disputeId: d.id, outcome: "release" });
    } else {
      const [funding] = await tx
        .select()
        .from(paymentIntents)
        .where(and(eq(paymentIntents.milestoneId, m.id), eq(paymentIntents.purpose, "milestone_funding"), eq(paymentIntents.status, "succeeded")));
      if (!funding) throw new AppError("CONFLICT", "No confirmed funding payment to refund");
      await moveDispute(tx, d, "resolved_refund", actor.userId, note);
      await moveMilestone(tx, m, "refund_pending", staff, { disputeId: d.id, outcome: "refund" });
      intentId = (await createIntent(tx, provider, { purpose: "milestone_refund", target: { milestoneId: m.id }, amountMinor: m.amountMinor, currency: m.currency, description: `Refund milestone ${m.seq}`, createdBy: actor.userId, paymentRef: funding.providerRef })).intentId;
    }
    await audit(tx, { actorId: actor.userId, action: `dispute.resolved_${outcome}`, entityType: "dispute", entityId: d.id, data: { note, milestoneId: m.id, intentId } });
    for (const uid of [c.clientId, c.freelancerId]) {
      await notify(tx, { userId: uid, category: "payments", kind: "dispute.resolved", title: `Dispute resolved: ${outcome === "release" ? "payment to be released" : "refund to client"}`, body: note.slice(0, 200), link: `/app/contracts/${c.id}`, dedupeKey: `dispute.resolved:${d.id}` });
    }
    return { intentId };
  });
}

registerPaymentHandler("milestone_refund", async (tx, intent, succeeded, event) => {
  const [m] = await tx.select().from(milestones).where(eq(milestones.id, intent.milestoneId!)).for("update");
  const actor = { id: null, kind: "provider_webhook" as const };
  if (succeeded) {
    await moveMilestone(tx, m, "refunded", actor, { eventId: event.id, intentId: intent.id });
    await postTransaction(tx, { mode: intent.mode, currency: intent.currency, contractId: m.contractId, milestoneId: m.id, paymentIntentId: intent.id, memo: `Milestone ${m.seq} refunded (${intent.mode})` }, [
      { account: "milestone_payable", direction: "debit", amountMinor: intent.amountMinor },
      { account: "provider_balance", direction: "credit", amountMinor: intent.amountMinor },
    ]);
    await completeContractIfDone(tx, m.contractId);
  } else {
    // Back to disputed so staff can retry or choose another resolution.
    await moveMilestone(tx, m, "disputed", actor, { eventId: event.id, reason: event.failureReason ?? null });
  }
});
