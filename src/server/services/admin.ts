import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { abuseReports, adminRoles, auditLog, disputes, paymentIntents, providerWebhookEvents, reviews, serviceListings, sessions, supportTickets, users } from "@/db/schema";
import { type AdminPermission, type AdminRole, requireAdmin } from "@/domain/admin";
import { AppError } from "@/domain/errors";
import type { Actor } from "@/domain/permissions";
import { audit } from "./audit";
import { notify } from "./notifications";

export async function staffRoles(db: Executor, userId: string): Promise<AdminRole[]> {
  const rows = await db.select({ role: adminRoles.role }).from(adminRoles).where(eq(adminRoles.userId, userId));
  return rows.map((r) => r.role);
}

/** Loads the caller's staff roles and enforces one permission. Returns the roles for UI decisions. */
export async function requireStaff(db: Executor, actor: Actor, perm: AdminPermission) {
  const roles = await staffRoles(db, actor.userId);
  requireAdmin(roles, perm);
  return roles;
}

export async function dashboardCounts(db: Executor) {
  const [[u], [r], [s], [t], [d], [w]] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(abuseReports).where(or(eq(abuseReports.status, "open"), eq(abuseReports.status, "reviewing"))),
    db.select({ n: count() }).from(serviceListings).where(eq(serviceListings.status, "pending_review")),
    db.select({ n: count() }).from(supportTickets).where(or(eq(supportTickets.status, "open"), eq(supportTickets.status, "waiting_on_user"))),
    db.select({ n: count() }).from(disputes).where(or(eq(disputes.status, "open"), eq(disputes.status, "under_review"))),
    db.select({ n: count() }).from(providerWebhookEvents),
  ]);
  return { users: Number(u.n), openReports: Number(r.n), pendingServices: Number(s.n), openTickets: Number(t.n), openDisputes: Number(d.n), webhookEvents: Number(w.n) };
}

export async function searchUsers(db: Executor, actor: Actor, q: string) {
  await requireStaff(db, actor, "users.read");
  const term = q.trim().slice(0, 100);
  return db
    .select({ id: users.id, email: users.email, displayName: users.displayName, status: users.status, isDemo: users.isDemo, createdAt: users.createdAt, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(term ? or(ilike(users.email, `%${term}%`), ilike(users.displayName, `%${term}%`)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(50);
}

/** Suspend/reinstate. Suspension revokes all sessions immediately. Always audited with a reason. */
export async function setUserStatus(db: DB, actor: Actor, userId: string, status: "active" | "suspended", reason: string) {
  await requireStaff(db, actor, "users.suspend");
  if (userId === actor.userId) throw new AppError("FORBIDDEN", "You can't change your own account status");
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "Give a reason (shown in the audit log)", { reason: "Required" });
  const targetRoles = await staffRoles(db, userId);
  if (targetRoles.includes("superadmin")) throw new AppError("FORBIDDEN", "Superadmins can't be suspended from the console");
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new AppError("NOT_FOUND", "User not found");
    await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
    if (status === "suspended") await tx.delete(sessions).where(eq(sessions.userId, userId));
    await audit(tx, { actorId: actor.userId, action: status === "suspended" ? "admin.user_suspended" : "admin.user_reinstated", entityType: "user", entityId: userId, data: { reason: reason.trim().slice(0, 500), from: u.status } });
  });
}

export async function grantRole(db: DB, actor: Actor, userId: string, role: AdminRole, grant: boolean) {
  await requireStaff(db, actor, "roles.grant");
  await db.transaction(async (tx) => {
    if (grant) {
      await tx.insert(adminRoles).values({ userId, role, grantedBy: actor.userId }).onConflictDoNothing();
      await tx.execute(sql`insert into user_capabilities (user_id, capability) values (${userId}, 'admin') on conflict do nothing`);
    } else {
      if (userId === actor.userId && role === "superadmin") throw new AppError("FORBIDDEN", "You can't remove your own superadmin role");
      await tx.delete(adminRoles).where(and(eq(adminRoles.userId, userId), eq(adminRoles.role, role)));
    }
    await audit(tx, { actorId: actor.userId, action: grant ? "admin.role_granted" : "admin.role_revoked", entityType: "user", entityId: userId, data: { role } });
  });
}

export async function listReports(db: Executor, actor: Actor, status?: string) {
  await requireStaff(db, actor, "reports.handle");
  return db
    .select({ r: abuseReports, reporterName: users.displayName })
    .from(abuseReports)
    .innerJoin(users, eq(users.id, abuseReports.reporterId))
    .where(status ? eq(abuseReports.status, status as never) : undefined)
    .orderBy(desc(abuseReports.createdAt))
    .limit(100);
}

export async function handleReport(db: DB, actor: Actor, reportId: string, status: "reviewing" | "actioned" | "dismissed", note: string) {
  await requireStaff(db, actor, "reports.handle");
  if (status !== "reviewing" && note.trim().length < 5) throw new AppError("VALIDATION", "Add a resolution note", { note: "Required" });
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(abuseReports).where(eq(abuseReports.id, reportId)).for("update");
    if (!r) throw new AppError("NOT_FOUND", "Report not found");
    if (r.status === "actioned" || r.status === "dismissed") throw new AppError("INVALID_TRANSITION", "Report already closed");
    await tx.update(abuseReports).set({ status, resolutionNote: note.trim() || null, handledBy: actor.userId, handledAt: new Date() }).where(eq(abuseReports.id, reportId));
    await audit(tx, { actorId: actor.userId, action: `report.${status}`, entityType: "abuse_report", entityId: reportId, data: { note: note.trim().slice(0, 500) } });
    if (status !== "reviewing") {
      await notify(tx, { userId: r.reporterId, category: "safety", kind: "report.closed", title: "Your report was reviewed", body: "Thank you. We reviewed your report and took the appropriate action.", link: "/app/support", dedupeKey: `report.closed:${r.id}` });
    }
  });
}

export async function paymentLog(db: Executor, actor: Actor) {
  await requireStaff(db, actor, "payments.read");
  const [intents, events] = await Promise.all([
    db.select().from(paymentIntents).orderBy(desc(paymentIntents.createdAt)).limit(100),
    db.select().from(providerWebhookEvents).orderBy(desc(providerWebhookEvents.receivedAt)).limit(100),
  ]);
  return { intents, events };
}

export async function auditTrail(db: Executor, actor: Actor) {
  await requireStaff(db, actor, "audit.read");
  return db
    .select({ a: auditLog, actorName: users.displayName })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);
}

/** Recent reviews for moderation (moderation.reviews), including not-yet-revealed ones (staff only). */
export async function reviewsForModeration(db: Executor, actor: Actor) {
  await requireStaff(db, actor, "moderation.reviews");
  return db
    .select({ r: reviews, reviewerName: users.displayName })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.reviewerId))
    .orderBy(desc(reviews.createdAt))
    .limit(100);
}

export async function rolesForUsers(db: Executor, actor: Actor, ids: string[]) {
  await requireStaff(db, actor, "users.read");
  if (!ids.length) return [];
  return db.select({ userId: adminRoles.userId, role: adminRoles.role }).from(adminRoles).where(inArray(adminRoles.userId, ids));
}
