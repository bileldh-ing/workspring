import { and, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { contracts, reviews, serviceOrders, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import type { Actor } from "@/domain/permissions";
import { averageRating, REVIEW_WINDOW_DAYS, reviewWindowOpen } from "@/domain/reviews";
import { parseOrThrow, reviewSchema } from "@/domain/validation";
import { isUniqueViolation } from "./db-errors";
import { notify } from "./notifications";

type Target = { kind: "contract" | "order"; id: string };

/** Eligibility: only parties of a COMPLETED contract/order, within the review window, once per reviewer. */
async function eligibility(db: Executor, actor: Actor, t: Target) {
  if (t.kind === "contract") {
    const [c] = await db.select().from(contracts).where(eq(contracts.id, t.id));
    if (!c || (c.clientId !== actor.userId && c.freelancerId !== actor.userId)) throw new AppError("NOT_FOUND", "Contract not found");
    if (c.status !== "completed" || !c.endedAt) throw new AppError("FORBIDDEN", "Reviews open when the contract is completed");
    const role = c.clientId === actor.userId ? "client" : "freelancer";
    return { completedAt: c.endedAt, role, revieweeId: role === "client" ? c.freelancerId : c.clientId };
  }
  const [o] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, t.id));
  if (!o || (o.buyerId !== actor.userId && o.sellerId !== actor.userId)) throw new AppError("NOT_FOUND", "Order not found");
  if (o.status !== "completed" || !o.completedAt) throw new AppError("FORBIDDEN", "Reviews open when the order is completed");
  const role = o.buyerId === actor.userId ? "client" : "freelancer";
  return { completedAt: o.completedAt, role, revieweeId: role === "client" ? o.sellerId : o.buyerId };
}

/**
 * Double-blind: a review stays hidden until the other party also reviews or the 14-day window closes,
 * so neither side can retaliate after reading the other's review.
 */
export async function submitReview(db: DB, actor: Actor, t: Target, raw: unknown, now = new Date()) {
  const input = parseOrThrow(reviewSchema, raw);
  return db.transaction(async (tx) => {
    const el = await eligibility(tx, actor, t);
    if (!reviewWindowOpen(el.completedAt, now)) throw new AppError("FORBIDDEN", `The ${REVIEW_WINDOW_DAYS}-day review window has closed`);
    const col = t.kind === "contract" ? reviews.contractId : reviews.orderId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`review:${t.kind}:${t.id}`}))`);
    try {
      const [r] = await tx
        .insert(reviews)
        .values({ contractId: t.kind === "contract" ? t.id : null, orderId: t.kind === "order" ? t.id : null, reviewerId: actor.userId, revieweeId: el.revieweeId, reviewerRole: el.role, rating: input.rating, body: input.body })
        .returning();
      const both = await tx.select().from(reviews).where(eq(col, t.id));
      if (both.length >= 2) await tx.update(reviews).set({ visibleAt: now }).where(and(eq(col, t.id), isNull(reviews.visibleAt)));
      await notify(tx, { userId: el.revieweeId, category: "reviews", kind: "review.received", title: both.length >= 2 ? "Reviews are now visible" : "You received a review", body: both.length >= 2 ? undefined : "Leave yours to reveal both, or it appears when the review window closes.", link: t.kind === "contract" ? `/app/contracts/${t.id}` : `/app/orders/${t.id}`, dedupeKey: `review:${r.id}` });
      return r;
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("CONFLICT", "You already reviewed this");
      throw e;
    }
  });
}

/** Reveals reviews whose window has closed (run on read and by the maintenance script). */
export async function revealExpired(db: Executor, now = new Date()) {
  const cutoff = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 86400_000);
  await db.execute(sql`
    update reviews r set visible_at = ${now}
    where r.visible_at is null and (
      (r.contract_id is not null and exists (select 1 from contracts c where c.id = r.contract_id and c.ended_at <= ${cutoff})) or
      (r.order_id is not null and exists (select 1 from service_orders o where o.id = r.order_id and o.completed_at <= ${cutoff})))`);
}

export async function reviewStateFor(db: Executor, actor: Actor, t: Target) {
  const col = t.kind === "contract" ? reviews.contractId : reviews.orderId;
  const rows = await db.select().from(reviews).where(eq(col, t.id));
  const mine = rows.find((r) => r.reviewerId === actor.userId) ?? null;
  const theirs = rows.find((r) => r.reviewerId !== actor.userId) ?? null;
  let canReview = false;
  try {
    const el = await eligibility(db, actor, t);
    canReview = !mine && reviewWindowOpen(el.completedAt);
  } catch {
    canReview = false;
  }
  return { mine, theirs: theirs && theirs.visibleAt && !theirs.hiddenByModeration ? theirs : null, theirsPending: !!theirs && !theirs.visibleAt, canReview };
}

/** Public reviews about a user: visible and not hidden by moderation. */
export async function publicReviewsFor(db: Executor, userId: string) {
  await revealExpired(db);
  const rows = await db
    .select({ r: reviews, reviewerName: users.displayName })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.reviewerId))
    .where(and(eq(reviews.revieweeId, userId), isNotNull(reviews.visibleAt), lte(reviews.visibleAt, new Date()), eq(reviews.hiddenByModeration, false)))
    .orderBy(desc(reviews.visibleAt))
    .limit(50);
  return { reviews: rows, ...averageRating(rows.map((x) => x.r.rating)) };
}

export async function setReviewHidden(db: DB, staffId: string, reviewId: string, hidden: boolean, note: string) {
  const { audit } = await import("./audit");
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!r) throw new AppError("NOT_FOUND", "Review not found");
    await tx.update(reviews).set({ hiddenByModeration: hidden }).where(eq(reviews.id, reviewId));
    await audit(tx, { actorId: staffId, action: hidden ? "review.hidden" : "review.restored", entityType: "review", entityId: reviewId, data: { note } });
  });
}

