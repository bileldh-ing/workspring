import { and, desc, eq } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { freelancerProfiles, jobInvitations, jobs, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { type Actor, assertNotSelf, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import { assertTransition, invitationMachine } from "@/domain/state-machines";
import { invitationSchema, parseOrThrow } from "@/domain/validation";
import { isUniqueViolation } from "./db-errors";
import { notify } from "./notifications";
import { assertNotBlocked } from "./safety";

export const INVITATION_TTL_DAYS = 14;
type InvStatus = (typeof jobInvitations.$inferSelect)["status"];

/** Client invites a freelancer (with a published profile) to apply to one of the client's open jobs. */
export async function inviteToJob(db: DB, actor: Actor, raw: unknown) {
  requireCapability(actor, "client");
  requireVerifiedEmail(actor);
  const input = parseOrThrow(invitationSchema, raw);
  assertNotSelf(actor.userId, input.freelancerId, "You can't invite yourself");
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, input.jobId), eq(jobs.clientId, actor.userId)));
  if (!job) throw new AppError("NOT_FOUND", "Job not found");
  if (job.status !== "open") throw new AppError("CONFLICT", "Only open jobs can receive invitations");
  const [profile] = await db.select().from(freelancerProfiles).where(eq(freelancerProfiles.userId, input.freelancerId));
  if (!profile || profile.status !== "published") throw new AppError("NOT_FOUND", "Freelancer not found");
  await assertNotBlocked(db, actor.userId, input.freelancerId);
  try {
    return await db.transaction(async (tx) => {
      const [inv] = await tx
        .insert(jobInvitations)
        .values({ jobId: job.id, clientId: actor.userId, freelancerId: input.freelancerId, message: input.message, expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86400_000) })
        .returning();
      await notify(tx, { userId: input.freelancerId, category: "proposals", kind: "invitation.received", title: `You're invited to apply: "${job.title}"`, body: input.message.slice(0, 200), link: `/app/invitations`, dedupeKey: `invitation:${inv.id}` });
      return inv;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "This freelancer already has a pending invitation to this job");
    throw e;
  }
}

export async function listInvitations(db: Executor, actor: Actor) {
  const rows = await db
    .select({ inv: jobInvitations, jobTitle: jobs.title, jobSlug: jobs.slug, jobId: jobs.id, jobStatus: jobs.status, clientName: users.displayName })
    .from(jobInvitations)
    .innerJoin(jobs, eq(jobs.id, jobInvitations.jobId))
    .innerJoin(users, eq(users.id, jobInvitations.clientId))
    .where(eq(jobInvitations.freelancerId, actor.userId))
    .orderBy(desc(jobInvitations.createdAt));
  const now = new Date();
  return rows.map((r) => ({ ...r, effectiveStatus: r.inv.status === "sent" && r.inv.expiresAt < now ? ("expired" as const) : r.inv.status }));
}

export async function listSentInvitations(db: Executor, actor: Actor, jobId: string) {
  return db
    .select({ inv: jobInvitations, freelancerName: users.displayName })
    .from(jobInvitations)
    .innerJoin(users, eq(users.id, jobInvitations.freelancerId))
    .where(and(eq(jobInvitations.jobId, jobId), eq(jobInvitations.clientId, actor.userId)))
    .orderBy(desc(jobInvitations.createdAt));
}

async function move(tx: Executor, id: string, guard: (inv: typeof jobInvitations.$inferSelect) => boolean, to: InvStatus, reason?: string) {
  const [inv] = await tx.select().from(jobInvitations).where(eq(jobInvitations.id, id)).for("update");
  if (!inv || !guard(inv)) throw new AppError("NOT_FOUND", "Invitation not found");
  const from = inv.status === "sent" && inv.expiresAt < new Date() ? "expired" : inv.status;
  if (from === "expired" && inv.status === "sent") {
    await tx.update(jobInvitations).set({ status: "expired" }).where(eq(jobInvitations.id, id));
    throw new AppError("INVALID_TRANSITION", "This invitation has expired");
  }
  assertTransition(invitationMachine, from, to, "invitation");
  await tx.update(jobInvitations).set({ status: to, respondedAt: new Date(), declineReason: reason ?? null }).where(eq(jobInvitations.id, id));
  return inv;
}

export async function declineInvitation(db: DB, actor: Actor, id: string, reason?: string) {
  return db.transaction(async (tx) => {
    const inv = await move(tx, id, (i) => i.freelancerId === actor.userId, "declined", reason?.slice(0, 500));
    await notify(tx, { userId: inv.clientId, category: "proposals", kind: "invitation.declined", title: "An invitation was declined", body: reason?.slice(0, 200), link: `/app/jobs/${inv.jobId}`, dedupeKey: `invitation.declined:${id}` });
  });
}

export async function revokeInvitation(db: DB, actor: Actor, id: string) {
  return db.transaction((tx) => move(tx, id, (i) => i.clientId === actor.userId, "revoked"));
}
