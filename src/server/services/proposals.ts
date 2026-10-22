import { and, desc, eq, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { freelancerProfiles, jobInvitations, jobScreeningQuestions, jobs, proposalAnswers, proposalEvents, proposals, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { isCurrency, toMinor } from "@/domain/money";
import { type Actor, assertNotSelf, canReadProposal, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import { assertTransition, proposalMachine } from "@/domain/state-machines";
import { declineSchema, parseOrThrow, proposalSchema } from "@/domain/validation";
import { isUniqueViolation } from "./db-errors";
import { notify } from "./notifications";
import { assertNotBlocked } from "./safety";

type ProposalStatus = (typeof proposals.$inferSelect)["status"];

export async function submitProposal(db: DB, actor: Actor, raw: unknown) {
  requireCapability(actor, "freelancer");
  requireVerifiedEmail(actor);
  const input = parseOrThrow(proposalSchema, raw);
  const [profile] = await db.select().from(freelancerProfiles).where(eq(freelancerProfiles.userId, actor.userId));
  if (!profile || profile.status !== "published") {
    throw new AppError("FORBIDDEN", "Publish your freelancer profile before sending proposals");
  }
  const [job] = await db.select().from(jobs).where(eq(jobs.id, input.jobId));
  if (!job || job.status === "draft") throw new AppError("NOT_FOUND", "Job not found");
  if (job.status !== "open") throw new AppError("CONFLICT", "This job is not accepting proposals");
  assertNotSelf(actor.userId, job.clientId, "You can't apply to your own job");
  await assertNotBlocked(db, actor.userId, job.clientId);
  const questions = await db.select().from(jobScreeningQuestions).where(eq(jobScreeningQuestions.jobId, job.id)).orderBy(jobScreeningQuestions.seq);
  const answers = questions.map((q) => ({ q, answer: (input.answers[q.id] ?? "").trim() }));
  const missing = answers.filter((a) => a.q.required && a.answer.length < 2);
  if (missing.length) {
    throw new AppError("VALIDATION", "Answer every screening question", Object.fromEntries(missing.map((m) => [`answers.${m.q.id}`, "Required"])));
  }
  if (!isCurrency(job.currency)) throw new AppError("VALIDATION", "Unsupported currency");
  const amountMinor = toMinor(input.amount, job.currency);
  const termsSnapshot = {
    rateType: job.contractType,
    amountMinor,
    currency: job.currency,
    durationEstimate: input.durationEstimate,
    coverLetter: input.coverLetter,
    jobTitle: job.title,
    submittedAt: new Date().toISOString(),
  };
  try {
    return await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(proposals)
        .values({
          jobId: job.id,
          freelancerId: actor.userId,
          coverLetter: input.coverLetter,
          rateType: job.contractType,
          amountMinor,
          currency: job.currency,
          durationEstimate: input.durationEstimate,
          termsSnapshot,
        })
        .returning();
      await tx.insert(proposalEvents).values({ proposalId: p.id, actorId: actor.userId, fromStatus: null, toStatus: "submitted" });
      if (answers.length) await tx.insert(proposalAnswers).values(answers.map((a) => ({ proposalId: p.id, questionId: a.q.id, prompt: a.q.prompt, answer: a.answer })));
      // An open invitation to this job is fulfilled by applying.
      await tx
        .update(jobInvitations)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(and(eq(jobInvitations.jobId, job.id), eq(jobInvitations.freelancerId, actor.userId), eq(jobInvitations.status, "sent")));
      await notify(tx, { userId: job.clientId, category: "proposals", kind: "proposal.received", title: `New proposal on "${job.title}"`, body: `${actor.displayName} sent a proposal.`, link: `/app/proposals/${p.id}`, dedupeKey: `proposal.received:${p.id}` });
      return p;
    });
  } catch (e) {
    if (isUniqueViolation(e, "proposals_one_active_per_job_uq")) {
      throw new AppError("CONFLICT", "You already have an active proposal on this job");
    }
    throw e;
  }
}

/** Moves a proposal through its state machine inside an existing transaction, recording an event. */
export async function moveProposal(tx: Executor, id: string, from: ProposalStatus, to: ProposalStatus, actorId: string | null, note?: string) {
  assertTransition(proposalMachine, from, to, "proposal");
  await tx
    .update(proposals)
    .set({ status: to, updatedAt: new Date(), ...(to === "withdrawn" ? { withdrawnAt: new Date() } : {}), ...(to === "declined" && note ? { declineReason: note } : {}) })
    .where(eq(proposals.id, id));
  await tx.insert(proposalEvents).values({ proposalId: id, actorId, fromStatus: from, toStatus: to, note: note ?? null });
}

async function loadProposalForUpdate(tx: Executor, id: string) {
  const [row] = await tx
    .select({ p: proposals, job: jobs })
    .from(proposals)
    .innerJoin(jobs, eq(jobs.id, proposals.jobId))
    .where(eq(proposals.id, id))
    .for("update", { of: proposals });
  return row ?? null;
}

export async function withdrawProposal(db: DB, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const row = await loadProposalForUpdate(tx, id);
    if (!row || row.p.freelancerId !== actor.userId) throw new AppError("NOT_FOUND", "Proposal not found");
    if (row.p.status === "offer_sent") throw new AppError("INVALID_TRANSITION", "Respond to the pending offer instead (decline it to withdraw)");
    await moveProposal(tx, id, row.p.status, "withdrawn", actor.userId);
  });
}

export async function setProposalReview(db: DB, actor: Actor, id: string, action: "shortlist" | "unshortlist" | "decline", raw?: unknown) {
  requireCapability(actor, "client");
  const note = action === "decline" ? parseOrThrow(declineSchema, raw ?? {}).reason : undefined;
  return db.transaction(async (tx) => {
    const row = await loadProposalForUpdate(tx, id);
    if (!row || row.job.clientId !== actor.userId) throw new AppError("NOT_FOUND", "Proposal not found");
    const to: ProposalStatus = action === "shortlist" ? "shortlisted" : action === "unshortlist" ? "submitted" : "declined";
    await moveProposal(tx, id, row.p.status, to, actor.userId, note);
    if (to === "declined" || to === "shortlisted") {
      await notify(tx, { userId: row.p.freelancerId, category: "proposals", kind: `proposal.${to}`, title: `Your proposal for "${row.job.title}" was ${to}`, body: note ?? undefined, link: `/app/proposals/${id}`, dedupeKey: `proposal.${to}:${id}` });
    }
  });
}

/** A single proposal, visible only to its author and to the job's client. */
export async function getProposal(db: Executor, actor: Actor, id: string) {
  const [row] = await db
    .select({ p: proposals, job: jobs, freelancerName: users.displayName, freelancerSlug: freelancerProfiles.slug, freelancerTitle: freelancerProfiles.title })
    .from(proposals)
    .innerJoin(jobs, eq(jobs.id, proposals.jobId))
    .innerJoin(users, eq(users.id, proposals.freelancerId))
    .leftJoin(freelancerProfiles, eq(freelancerProfiles.userId, proposals.freelancerId))
    .where(eq(proposals.id, id));
  if (!row || !canReadProposal(actor, row.p, row.job)) throw new AppError("NOT_FOUND", "Proposal not found");
  const events = await db.select().from(proposalEvents).where(eq(proposalEvents.proposalId, id)).orderBy(desc(proposalEvents.createdAt));
  const answers = await db.select().from(proposalAnswers).where(eq(proposalAnswers.proposalId, id));
  return { ...row, events, answers, viewerRole: actor.userId === row.job.clientId ? ("client" as const) : ("freelancer" as const) };
}

export async function listMyProposals(db: Executor, actor: Actor, status?: ProposalStatus) {
  requireCapability(actor, "freelancer");
  return db
    .select({ p: proposals, jobTitle: jobs.title, jobSlug: jobs.slug, jobStatus: jobs.status })
    .from(proposals)
    .innerJoin(jobs, eq(jobs.id, proposals.jobId))
    .where(and(eq(proposals.freelancerId, actor.userId), status ? eq(proposals.status, status) : undefined))
    .orderBy(desc(proposals.submittedAt));
}

/** Incoming proposals for one of the caller's own jobs. Withdrawn proposals are hidden. */
export async function listJobProposals(db: Executor, actor: Actor, jobId: string, status?: ProposalStatus) {
  requireCapability(actor, "client");
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.clientId, actor.userId)));
  if (!job) throw new AppError("NOT_FOUND", "Job not found");
  return db
    .select({ p: proposals, freelancerName: users.displayName, freelancerSlug: freelancerProfiles.slug, freelancerTitle: freelancerProfiles.title })
    .from(proposals)
    .innerJoin(users, eq(users.id, proposals.freelancerId))
    .leftJoin(freelancerProfiles, eq(freelancerProfiles.userId, proposals.freelancerId))
    .where(and(eq(proposals.jobId, jobId), status ? eq(proposals.status, status) : sql`${proposals.status} <> 'withdrawn'`))
    .orderBy(desc(proposals.submittedAt));
}
