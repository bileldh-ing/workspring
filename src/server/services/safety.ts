import { and, eq, or } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { abuseReports, userBlocks, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import type { Actor } from "@/domain/permissions";
import { parseOrThrow, reportSchema } from "@/domain/validation";
import { isUniqueViolation } from "./db-errors";

export async function isBlockedEitherWay(db: Executor, a: string, b: string) {
  const [r] = await db
    .select({ x: userBlocks.blockerId })
    .from(userBlocks)
    .where(or(and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)), and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a))));
  return !!r;
}

/** Throws a neutral error when either party blocked the other (does not reveal who blocked whom). */
export async function assertNotBlocked(db: Executor, a: string, b: string) {
  if (await isBlockedEitherWay(db, a, b)) throw new AppError("FORBIDDEN", "You can't interact with this member");
}

export async function blockUser(db: DB, actor: Actor, targetId: string) {
  if (targetId === actor.userId) throw new AppError("VALIDATION", "You can't block yourself");
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
  if (!u) throw new AppError("NOT_FOUND", "Member not found");
  await db.insert(userBlocks).values({ blockerId: actor.userId, blockedId: targetId }).onConflictDoNothing();
}

export async function unblockUser(db: DB, actor: Actor, targetId: string) {
  await db.delete(userBlocks).where(and(eq(userBlocks.blockerId, actor.userId), eq(userBlocks.blockedId, targetId)));
}

export async function listBlocked(db: Executor, actor: Actor) {
  return db.select({ id: users.id, displayName: users.displayName, since: userBlocks.createdAt }).from(userBlocks).innerJoin(users, eq(users.id, userBlocks.blockedId)).where(eq(userBlocks.blockerId, actor.userId));
}

/** Files an abuse report. Report details are visible only to staff with reports.handle. */
export async function fileReport(db: DB, actor: Actor, raw: unknown) {
  const input = parseOrThrow(reportSchema, raw);
  if (input.targetType === "user" && input.targetId === actor.userId) throw new AppError("VALIDATION", "You can't report yourself");
  try {
    const [r] = await db.insert(abuseReports).values({ reporterId: actor.userId, targetType: input.targetType, targetId: input.targetId, reason: input.reason, details: input.details || null }).returning();
    return r;
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "You already have an open report about this. Our team will review it.");
    throw e;
  }
}
