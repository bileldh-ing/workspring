import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { categories, freelancerProfiles, serviceAddons, serviceListingEvents, serviceListings, serviceRequirements, serviceTiers, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { toMinor } from "@/domain/money";
import { type Actor, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import { assertTransition, type ServiceStatus, serviceMachine } from "@/domain/state-machines";
import { parseOrThrow, serviceSchema } from "@/domain/validation";
import { audit } from "./audit";
import { notify } from "./notifications";
import { categoryBySlug, slugify } from "./taxonomy";

export const SERVICE_PAGE_SIZE = 12;
const TIERS = ["starter", "standard", "advanced"] as const;

async function normalize(db: Executor, raw: unknown) {
  const input = parseOrThrow(serviceSchema, raw);
  const cat = await categoryBySlug(db, input.categorySlug);
  const tiers = TIERS.map((t) => ({ tier: t, ...input.tiers[t], priceMinor: toMinor(input.tiers[t].price, input.currency) }));
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].priceMinor < tiers[i - 1].priceMinor) throw new AppError("VALIDATION", "Each tier should cost at least as much as the one before it", { [`tiers.${tiers[i].tier}.price`]: "Must be ≥ previous tier" });
  }
  return { input, cat, tiers, addons: input.addons.map((a) => ({ ...a, priceMinor: toMinor(a.price, input.currency) })) };
}

async function writeChildren(tx: Executor, listingId: string, n: Awaited<ReturnType<typeof normalize>>) {
  await tx.delete(serviceTiers).where(eq(serviceTiers.listingId, listingId));
  await tx.delete(serviceAddons).where(eq(serviceAddons.listingId, listingId));
  await tx.delete(serviceRequirements).where(eq(serviceRequirements.listingId, listingId));
  await tx.insert(serviceTiers).values(n.tiers.map((t) => ({ listingId, tier: t.tier, name: t.name, description: t.description, priceMinor: t.priceMinor, deliveryDays: t.deliveryDays, revisions: t.revisions })));
  if (n.addons.length) await tx.insert(serviceAddons).values(n.addons.map((a) => ({ listingId, name: a.name, priceMinor: a.priceMinor, extraDays: a.extraDays })));
  if (n.input.requirements.length) await tx.insert(serviceRequirements).values(n.input.requirements.map((prompt, i) => ({ listingId, seq: i + 1, prompt })));
}

export async function createService(db: DB, actor: Actor, raw: unknown) {
  requireCapability(actor, "freelancer");
  const n = await normalize(db, raw);
  return db.transaction(async (tx) => {
    const slug = `${slugify(n.input.title) || "service"}-${crypto.randomUUID().slice(0, 8)}`;
    const [l] = await tx
      .insert(serviceListings)
      .values({ freelancerId: actor.userId, slug, title: n.input.title, categoryId: n.cat.id, summary: n.input.summary, description: n.input.description, currency: n.input.currency, maxConcurrentOrders: n.input.maxConcurrentOrders })
      .returning();
    await writeChildren(tx, l.id, n);
    await tx.insert(serviceListingEvents).values({ listingId: l.id, actorId: actor.userId, fromStatus: null, toStatus: "draft" });
    return l;
  });
}

async function lockOwned(tx: Executor, actor: Actor, id: string) {
  const [l] = await tx.select().from(serviceListings).where(and(eq(serviceListings.id, id), eq(serviceListings.freelancerId, actor.userId))).for("update");
  if (!l) throw new AppError("NOT_FOUND", "Service not found");
  return l;
}

async function moveListing(tx: Executor, l: typeof serviceListings.$inferSelect, to: ServiceStatus, actorId: string, note?: string) {
  assertTransition(serviceMachine, l.status, to, "service");
  await tx.update(serviceListings).set({ status: to, updatedAt: new Date(), moderationNote: note ?? (to === "published" ? null : l.moderationNote), ...(to === "published" ? { publishedAt: l.publishedAt ?? new Date() } : {}) }).where(eq(serviceListings.id, l.id));
  await tx.insert(serviceListingEvents).values({ listingId: l.id, actorId, fromStatus: l.status, toStatus: to, note: note ?? null });
}

/** Editing a published listing sends it back through moderation (changes are reviewed before going live). */
export async function updateService(db: DB, actor: Actor, id: string, raw: unknown) {
  requireCapability(actor, "freelancer");
  const n = await normalize(db, raw);
  return db.transaction(async (tx) => {
    const l = await lockOwned(tx, actor, id);
    if (l.status === "archived") throw new AppError("INVALID_TRANSITION", "Archived services can't be edited");
    await tx.update(serviceListings).set({ title: n.input.title, categoryId: n.cat.id, summary: n.input.summary, description: n.input.description, currency: n.input.currency, maxConcurrentOrders: n.input.maxConcurrentOrders, updatedAt: new Date() }).where(eq(serviceListings.id, id));
    await writeChildren(tx, id, n);
    if (l.status === "published" || l.status === "paused") {
      await moveListing(tx, { ...l, status: l.status === "paused" ? "published" : l.status }, "changes_requested", actor.userId, "Edited by owner: resubmit for review");
    }
  });
}

/** Owner actions: submit for review, pause, resume, archive. */
export async function ownerTransition(db: DB, actor: Actor, id: string, to: "pending_review" | "paused" | "published" | "archived") {
  requireCapability(actor, "freelancer");
  return db.transaction(async (tx) => {
    const l = await lockOwned(tx, actor, id);
    if (to === "published" && l.status !== "paused") throw new AppError("FORBIDDEN", "Listings are published by moderation");
    if (to === "pending_review") {
      requireVerifiedEmail(actor);
      const [p] = await tx.select({ s: freelancerProfiles.status }).from(freelancerProfiles).where(eq(freelancerProfiles.userId, actor.userId));
      if (p?.s !== "published") throw new AppError("FORBIDDEN", "Publish your freelancer profile before submitting a service");
    }
    await moveListing(tx, l, to, actor.userId);
  });
}

/** Moderation decision by staff (moderation.services). Audited. */
export async function moderateService(db: DB, staffId: string, id: string, decision: "approve" | "request_changes", note?: string) {
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(serviceListings).where(eq(serviceListings.id, id)).for("update");
    if (!l) throw new AppError("NOT_FOUND", "Service not found");
    if (decision === "request_changes" && !(note && note.trim().length >= 10)) throw new AppError("VALIDATION", "Explain what needs to change (10+ characters)", { note: "Required" });
    const to = decision === "approve" ? "published" : "changes_requested";
    await moveListing(tx, l, to, staffId, note?.trim());
    await audit(tx, { actorId: staffId, action: `service.${decision}`, entityType: "service_listing", entityId: id, data: { note: note ?? null } });
    await notify(tx, { userId: l.freelancerId, category: "orders", kind: `service.${to}`, title: decision === "approve" ? `Service published: ${l.title}` : `Changes requested: ${l.title}`, body: note, link: `/app/services/${l.id}`, dedupeKey: `service.${to}:${l.id}:${Date.now()}` });
  });
}

async function children(db: Executor, ids: string[]) {
  if (!ids.length) return { tiers: [], addons: [], reqs: [] };
  const [tiers, addons, reqs] = await Promise.all([
    db.select().from(serviceTiers).where(inArray(serviceTiers.listingId, ids)),
    db.select().from(serviceAddons).where(inArray(serviceAddons.listingId, ids)),
    db.select().from(serviceRequirements).where(inArray(serviceRequirements.listingId, ids)).orderBy(asc(serviceRequirements.seq)),
  ]);
  return { tiers, addons, reqs };
}

const tierOrder = (a: { tier: string }, b: { tier: string }) => TIERS.indexOf(a.tier as never) - TIERS.indexOf(b.tier as never);

export async function getOwnedService(db: Executor, actor: Actor, id: string) {
  const [l] = await db.select().from(serviceListings).where(and(eq(serviceListings.id, id), eq(serviceListings.freelancerId, actor.userId)));
  if (!l) throw new AppError("NOT_FOUND", "Service not found");
  const ch = await children(db, [l.id]);
  const [cat] = l.categoryId ? await db.select().from(categories).where(eq(categories.id, l.categoryId)) : [];
  const events = await db.select().from(serviceListingEvents).where(eq(serviceListingEvents.listingId, id)).orderBy(desc(serviceListingEvents.createdAt));
  return { ...l, categorySlug: cat?.slug ?? "", tiers: ch.tiers.sort(tierOrder), addons: ch.addons, requirements: ch.reqs, events };
}

export async function listMyServices(db: Executor, actor: Actor) {
  return db.select().from(serviceListings).where(eq(serviceListings.freelancerId, actor.userId)).orderBy(desc(serviceListings.updatedAt));
}

/** Public detail: published listings only (owners/staff see others via their own pages). */
export async function getPublicService(db: Executor, slug: string) {
  const [row] = await db
    .select({ l: serviceListings, sellerName: users.displayName, sellerSlug: freelancerProfiles.slug, sellerTitle: freelancerProfiles.title, categoryName: categories.name })
    .from(serviceListings)
    .innerJoin(users, eq(users.id, serviceListings.freelancerId))
    .leftJoin(freelancerProfiles, eq(freelancerProfiles.userId, serviceListings.freelancerId))
    .leftJoin(categories, eq(categories.id, serviceListings.categoryId))
    .where(and(eq(serviceListings.slug, slug), eq(serviceListings.status, "published")));
  if (!row) return null;
  const ch = await children(db, [row.l.id]);
  return { ...row.l, sellerName: row.sellerName, sellerSlug: row.sellerSlug, sellerTitle: row.sellerTitle, categoryName: row.categoryName, tiers: ch.tiers.sort(tierOrder), addons: ch.addons, requirements: ch.reqs };
}

export async function searchServices(db: Executor, p: { q?: string; category?: string; maxPrice?: number; sort?: string; page?: number }) {
  const where: SQL[] = [sql`l.status = 'published'`];
  const q = (p.q ?? "").trim().slice(0, 200);
  if (q) where.push(sql`l.search_tsv @@ websearch_to_tsquery('english', ${q})`);
  if (p.category) where.push(sql`c.slug = ${p.category}`);
  if (p.maxPrice !== undefined && Number.isFinite(p.maxPrice)) where.push(sql`st.price_minor <= ${Math.round(p.maxPrice)} * (case when l.currency = 'TND' then 1000 else 100 end)`);
  const page = Math.max(1, Math.min(500, Math.floor(p.page ?? 1)));
  const order = p.sort === "price_asc" ? sql`st.price_minor asc` : q ? sql`ts_rank(l.search_tsv, websearch_to_tsquery('english', ${q})) desc, l.published_at desc` : sql`l.published_at desc`;
  const rows = await db.execute<{ id: string; slug: string; title: string; summary: string; currency: string; starting_minor: number; delivery_days: number; seller_name: string; category_name: string | null; is_demo: boolean; total: number }>(sql`
    select l.id, l.slug, l.title, l.summary, l.currency, st.price_minor as starting_minor, st.delivery_days, u.display_name as seller_name, c.name as category_name, l.is_demo,
      count(*) over()::int as total
    from service_listings l
    join service_tiers st on st.listing_id = l.id and st.tier = 'starter'
    join users u on u.id = l.freelancer_id
    left join categories c on c.id = l.category_id
    where ${sql.join(where, sql` and `)}
    order by ${order}
    limit ${SERVICE_PAGE_SIZE} offset ${(page - 1) * SERVICE_PAGE_SIZE}`);
  return { total: rows[0]?.total ?? 0, page, pageSize: SERVICE_PAGE_SIZE, results: rows.map((r) => ({ ...r, starting_minor: Number(r.starting_minor) })) };
}

export async function listPendingServices(db: Executor) {
  return db
    .select({ l: serviceListings, sellerName: users.displayName })
    .from(serviceListings)
    .innerJoin(users, eq(users.id, serviceListings.freelancerId))
    .where(eq(serviceListings.status, "pending_review"))
    .orderBy(asc(serviceListings.updatedAt));
}

export async function getServiceForStaff(db: Executor, id: string) {
  const [l] = await db.select().from(serviceListings).where(eq(serviceListings.id, id));
  if (!l) throw new AppError("NOT_FOUND", "Service not found");
  const ch = await children(db, [id]);
  return { ...l, tiers: ch.tiers.sort(tierOrder), addons: ch.addons, requirements: ch.reqs };
}
