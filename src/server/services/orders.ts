import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { orderDeliveries, orderEvents, orderRequirementAnswers, platformFeeRules, serviceAddons, serviceListings, serviceOrders, serviceRequirements, serviceTiers, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { splitRelease, sumMinor } from "@/domain/money";
import { type Actor, assertNotSelf, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import { assertTransition, type OrderStatus, orderMachine } from "@/domain/state-machines";
import { deliverySchema, orderSchema, parseOrThrow, revisionSchema } from "@/domain/validation";
import { getPaymentProvider, type PaymentProvider } from "../payments";
import { notify } from "./notifications";
import { createIntent, postTransaction, registerPaymentHandler } from "./payments";
import { assertNotBlocked } from "./safety";

type Order = typeof serviceOrders.$inferSelect;
const ACTIVE: OrderStatus[] = ["requirements_pending", "in_progress", "delivered", "revision_requested", "release_pending"];

async function moveOrder(tx: Executor, o: Order, to: OrderStatus, actor: { id: string | null; kind: string }, extra: Partial<typeof serviceOrders.$inferInsert> = {}, note?: string) {
  assertTransition(orderMachine, o.status, to, "order");
  await tx.update(serviceOrders).set({ status: to, updatedAt: new Date(), ...extra }).where(eq(serviceOrders.id, o.id));
  await tx.insert(orderEvents).values({ orderId: o.id, actorId: actor.id, actorKind: actor.kind, fromStatus: o.status, toStatus: to, note: note ?? null });
}

/**
 * Buyer checks out a tier (+ add-ons). Price, tier, add-ons, requirements and fee rule are snapshotted. The order
 * is created as pending_payment and unlocks work ONLY when a verified provider webhook confirms payment.
 */
export async function placeOrder(db: DB, actor: Actor, raw: unknown, provider: PaymentProvider = getPaymentProvider()) {
  requireCapability(actor, "client");
  requireVerifiedEmail(actor);
  if (!provider.configured) throw new AppError("PROVIDER_UNCONFIGURED", provider.unavailableReason ?? "Payments are not configured");
  const input = parseOrThrow(orderSchema, raw);
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(serviceListings).where(eq(serviceListings.id, input.listingId)).for("update");
    if (!l || l.status !== "published") throw new AppError("NOT_FOUND", "Service not found");
    assertNotSelf(actor.userId, l.freelancerId, "You can't order your own service");
    await assertNotBlocked(tx, actor.userId, l.freelancerId);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(serviceOrders).where(and(eq(serviceOrders.listingId, l.id), inArray(serviceOrders.status, ACTIVE)));
    if (Number(n) >= l.maxConcurrentOrders) throw new AppError("CONFLICT", "This service is at capacity right now. Try again later.");
    const [tier] = await tx.select().from(serviceTiers).where(and(eq(serviceTiers.listingId, l.id), eq(serviceTiers.tier, input.tier)));
    if (!tier) throw new AppError("VALIDATION", "Unknown tier");
    const addons = input.addonIds.length ? await tx.select().from(serviceAddons).where(and(eq(serviceAddons.listingId, l.id), inArray(serviceAddons.id, input.addonIds))) : [];
    if (addons.length !== new Set(input.addonIds).size) throw new AppError("VALIDATION", "Unknown add-on");
    const reqs = await tx.select().from(serviceRequirements).where(eq(serviceRequirements.listingId, l.id)).orderBy(asc(serviceRequirements.seq));
    const [fee] = await tx.select().from(platformFeeRules).where(eq(platformFeeRules.isActive, true)).orderBy(desc(platformFeeRules.version)).limit(1);
    if (!fee) throw new AppError("CONFLICT", "No active platform fee rule is configured");
    const totalMinor = sumMinor([tier.priceMinor, ...addons.map((a) => a.priceMinor)]);
    const deliveryDays = tier.deliveryDays + addons.reduce((a, x) => a + x.extraDays, 0);
    const feeSnap = { id: fee.id, version: fee.version, freelancerFeeBps: fee.freelancerFeeBps, clientFeeBps: fee.clientFeeBps };
    const [o] = await tx
      .insert(serviceOrders)
      .values({
        listingId: l.id,
        buyerId: actor.userId,
        sellerId: l.freelancerId,
        title: l.title,
        tier: tier.tier,
        snapshot: { tier: { name: tier.name, description: tier.description, priceMinor: tier.priceMinor, deliveryDays: tier.deliveryDays, revisions: tier.revisions }, addons: addons.map((a) => ({ name: a.name, priceMinor: a.priceMinor, extraDays: a.extraDays })), requirements: reqs.map((r) => ({ seq: r.seq, prompt: r.prompt, required: r.required })), paymentMode: provider.mode },
        currency: l.currency,
        totalMinor,
        feeRuleSnapshot: feeSnap,
        deliveryDays,
        revisionsAllowed: tier.revisions,
      })
      .returning();
    await tx.insert(orderEvents).values({ orderId: o.id, actorId: actor.userId, fromStatus: null, toStatus: "pending_payment" });
    const res = await createIntent(tx, provider, { purpose: "order_payment", target: { serviceOrderId: o.id }, amountMinor: totalMinor, currency: l.currency, description: `Service order: ${l.title} (${tier.name})`, createdBy: actor.userId });
    return { order: o, ...res };
  });
}

async function lockOrder(tx: Executor, actor: Actor, id: string) {
  const [o] = await tx.select().from(serviceOrders).where(eq(serviceOrders.id, id)).for("update");
  if (!o || (o.buyerId !== actor.userId && o.sellerId !== actor.userId)) throw new AppError("NOT_FOUND", "Order not found");
  return { o, role: o.buyerId === actor.userId ? ("buyer" as const) : ("seller" as const) };
}

/** Buyer resumes payment for a pending order (idempotent: reuses an open checkout). */
export async function resumeOrderPayment(db: DB, actor: Actor, id: string, provider: PaymentProvider = getPaymentProvider()) {
  if (!provider.configured) throw new AppError("PROVIDER_UNCONFIGURED", provider.unavailableReason ?? "Payments are not configured");
  return db.transaction(async (tx) => {
    const { o, role } = await lockOrder(tx, actor, id);
    if (role !== "buyer" || o.status !== "pending_payment") throw new AppError("INVALID_TRANSITION", "Nothing to pay");
    const open = await tx.execute<{ id: string }>(sql`select id from payment_intents where service_order_id = ${o.id} and purpose = 'order_payment' and status = 'requires_action' limit 1`);
    if (open[0]) return { intentId: open[0].id, actionUrl: provider.mode === "test" ? `/test-provider/checkout/${open[0].id}` : null };
    return createIntent(tx, provider, { purpose: "order_payment", target: { serviceOrderId: o.id }, amountMinor: o.totalMinor, currency: o.currency, description: `Service order: ${o.title}`, createdBy: actor.userId });
  });
}

export async function cancelUnpaidOrder(db: DB, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const { o, role } = await lockOrder(tx, actor, id);
    if (role !== "buyer") throw new AppError("FORBIDDEN", "Only the buyer can cancel an unpaid order");
    await moveOrder(tx, o, "canceled", { id: actor.userId, kind: "user" }, {}, "canceled before payment");
  });
}

/** Buyer submits the listing's requirements; this starts the delivery clock. */
export async function submitRequirements(db: DB, actor: Actor, id: string, answers: Record<string, string>) {
  return db.transaction(async (tx) => {
    const { o, role } = await lockOrder(tx, actor, id);
    if (role !== "buyer") throw new AppError("FORBIDDEN", "Only the buyer submits requirements");
    if (o.status !== "requirements_pending") throw new AppError("INVALID_TRANSITION", "Requirements can be submitted once payment is confirmed");
    const reqs = (o.snapshot as { requirements: { seq: number; prompt: string; required: boolean }[] }).requirements;
    const rows = reqs.map((r) => ({ ...r, answer: (answers[String(r.seq)] ?? "").trim().slice(0, 3000) }));
    const missing = rows.filter((r) => r.required && r.answer.length < 2);
    if (missing.length) throw new AppError("VALIDATION", "Answer every required question", Object.fromEntries(missing.map((m) => [`req.${m.seq}`, "Required"])));
    if (rows.length) await tx.insert(orderRequirementAnswers).values(rows.map((r) => ({ orderId: o.id, seq: r.seq, prompt: r.prompt, answer: r.answer || "(no answer)" })));
    const dueAt = new Date(Date.now() + o.deliveryDays * 86400_000);
    await moveOrder(tx, o, "in_progress", { id: actor.userId, kind: "user" }, { dueAt });
    await notify(tx, { userId: o.sellerId, category: "orders", kind: "order.started", title: `Order started: ${o.title}`, body: `Due ${dueAt.toISOString().slice(0, 10)}`, link: `/app/orders/${o.id}`, dedupeKey: `order.started:${o.id}` });
  });
}

export async function deliverOrder(db: DB, actor: Actor, id: string, raw: unknown) {
  const input = parseOrThrow(deliverySchema, raw);
  return db.transaction(async (tx) => {
    const { o, role } = await lockOrder(tx, actor, id);
    if (role !== "seller") throw new AppError("FORBIDDEN", "Only the seller delivers");
    const [{ v }] = await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0)::int + 1 as v from order_deliveries where order_id = ${o.id}`);
    await moveOrder(tx, o, "delivered", { id: actor.userId, kind: "user" }, {}, `delivery v${v}`);
    const [d] = await tx.insert(orderDeliveries).values({ orderId: o.id, version: Number(v), note: input.note }).returning();
    await notify(tx, { userId: o.buyerId, category: "orders", kind: "order.delivered", title: `Delivery received: ${o.title}`, body: "Approve it or request a revision.", link: `/app/orders/${o.id}`, dedupeKey: `order.delivered:${d.id}` });
    return d;
  });
}

export async function requestOrderRevision(db: DB, actor: Actor, id: string, raw: unknown) {
  const input = parseOrThrow(revisionSchema, raw);
  return db.transaction(async (tx) => {
    const { o, role } = await lockOrder(tx, actor, id);
    if (role !== "buyer") throw new AppError("FORBIDDEN", "Only the buyer can request a revision");
    if (o.revisionsUsed >= o.revisionsAllowed) throw new AppError("CONFLICT", `All ${o.revisionsAllowed} included revision(s) have been used`);
    const [latest] = await tx.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, o.id)).orderBy(desc(orderDeliveries.version)).limit(1);
    await moveOrder(tx, o, "revision_requested", { id: actor.userId, kind: "user" }, { revisionsUsed: o.revisionsUsed + 1 }, input.note.slice(0, 500));
    if (latest) await tx.update(orderDeliveries).set({ revisionNote: input.note }).where(eq(orderDeliveries.id, latest.id));
    await notify(tx, { userId: o.sellerId, category: "orders", kind: "order.revision", title: `Revision requested: ${o.title}`, body: input.note.slice(0, 200), link: `/app/orders/${o.id}`, dedupeKey: `order.revision:${o.id}:${o.revisionsUsed + 1}` });
  });
}

/** Buyer approves the delivery; a provider transfer is requested and the order completes on its verified webhook. */
export async function approveOrder(db: DB, actor: Actor, id: string, provider: PaymentProvider = getPaymentProvider()) {
  if (!provider.configured) throw new AppError("PROVIDER_UNCONFIGURED", provider.unavailableReason ?? "Payments are not configured");
  return db.transaction(async (tx) => {
    const { o, role } = await lockOrder(tx, actor, id);
    if (role !== "buyer") throw new AppError("FORBIDDEN", "Only the buyer approves");
    assertTransition(orderMachine, o.status, "release_pending", "order");
    const split = splitRelease(o.totalMinor, (o.feeRuleSnapshot as { freelancerFeeBps: number }).freelancerFeeBps);
    const res = await createIntent(tx, provider, { purpose: "order_release", target: { serviceOrderId: o.id }, amountMinor: o.totalMinor, feeMinor: split.feeMinor, currency: o.currency, description: `Release order ${o.title}`, createdBy: actor.userId });
    await moveOrder(tx, o, "release_pending", { id: actor.userId, kind: "user" }, {}, `intent ${res.intentId}`);
    return { ...res, ...split };
  });
}

export async function listMyOrders(db: Executor, actor: Actor) {
  return db
    .select({ o: serviceOrders, buyerName: users.displayName })
    .from(serviceOrders)
    .innerJoin(users, eq(users.id, serviceOrders.buyerId))
    .where(or(eq(serviceOrders.buyerId, actor.userId), eq(serviceOrders.sellerId, actor.userId)))
    .orderBy(desc(serviceOrders.createdAt));
}

export async function getOrder(db: Executor, actor: Actor, id: string) {
  const [o] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, id));
  if (!o || (o.buyerId !== actor.userId && o.sellerId !== actor.userId)) throw new AppError("NOT_FOUND", "Order not found");
  const [answers, deliveries, events, people, intents, [listing]] = await Promise.all([
    db.select().from(orderRequirementAnswers).where(eq(orderRequirementAnswers.orderId, id)).orderBy(asc(orderRequirementAnswers.seq)),
    db.select().from(orderDeliveries).where(eq(orderDeliveries.orderId, id)).orderBy(asc(orderDeliveries.version)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(desc(orderEvents.createdAt)),
    db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [o.buyerId, o.sellerId])),
    db.execute<{ id: string; purpose: string; status: string; amount_minor: number; fee_minor: number; mode: string; created_at: Date }>(sql`select id, purpose, status, amount_minor, fee_minor, mode, created_at from payment_intents where service_order_id = ${id} order by created_at desc`),
    db.select({ slug: serviceListings.slug }).from(serviceListings).where(eq(serviceListings.id, o.listingId)),
  ]);
  const name = (uid: string) => people.find((p) => p.id === uid)?.name ?? "";
  return { order: o, role: o.buyerId === actor.userId ? ("buyer" as const) : ("seller" as const), buyerName: name(o.buyerId), sellerName: name(o.sellerId), answers, deliveries, events, intents, listingSlug: listing?.slug ?? null };
}

registerPaymentHandler("order_payment", async (tx, intent, succeeded, event) => {
  const [o] = await tx.select().from(serviceOrders).where(eq(serviceOrders.id, intent.serviceOrderId!)).for("update");
  if (!succeeded) {
    await tx.insert(orderEvents).values({ orderId: o.id, actorId: null, actorKind: "provider_webhook", fromStatus: o.status, toStatus: o.status, note: `payment failed: ${event.failureReason ?? "unknown"}` });
    return;
  }
  if (o.status !== "pending_payment") return; // e.g. canceled before a late success; reconciliation handles refunds manually
  await moveOrder(tx, o, "requirements_pending", { id: null, kind: "provider_webhook" }, { paidAt: new Date() }, `event ${event.id}`);
  await postTransaction(tx, { mode: intent.mode, currency: intent.currency, contractId: null, milestoneId: null, serviceOrderId: o.id, paymentIntentId: intent.id, memo: `Order paid (${intent.mode})` }, [
    { account: "provider_balance", direction: "debit", amountMinor: intent.amountMinor },
    { account: "order_payable", direction: "credit", amountMinor: intent.amountMinor },
  ]);
  await notify(tx, { userId: o.sellerId, category: "orders", kind: "order.paid", title: `New paid order: ${o.title}`, body: "Waiting for the buyer's requirements.", link: `/app/orders/${o.id}`, dedupeKey: `order.paid:${intent.id}` });
  await notify(tx, { userId: o.buyerId, category: "payments", kind: "order.payment_confirmed", title: `Payment confirmed: ${o.title}`, body: "Submit your requirements to start the order.", link: `/app/orders/${o.id}`, dedupeKey: `order.payment_confirmed:${intent.id}` });
});

registerPaymentHandler("order_release", async (tx, intent, succeeded, event) => {
  const [o] = await tx.select().from(serviceOrders).where(eq(serviceOrders.id, intent.serviceOrderId!)).for("update");
  if (succeeded) {
    await moveOrder(tx, o, "completed", { id: null, kind: "provider_webhook" }, { completedAt: new Date() }, `event ${event.id}`);
    await postTransaction(tx, { mode: intent.mode, currency: intent.currency, contractId: null, milestoneId: null, serviceOrderId: o.id, paymentIntentId: intent.id, memo: `Order released (${intent.mode})` }, [
      { account: "order_payable", direction: "debit", amountMinor: intent.amountMinor },
      { account: "provider_balance", direction: "credit", amountMinor: intent.amountMinor - intent.feeMinor },
      { account: "platform_fee_revenue", direction: "credit", amountMinor: intent.feeMinor },
    ]);
    await notify(tx, { userId: o.sellerId, category: "payments", kind: "order.released", title: `Order completed and paid: ${o.title}`, body: intent.mode === "test" ? "TEST MODE: no real money moved." : undefined, link: `/app/orders/${o.id}`, dedupeKey: `order.released:${intent.id}` });
  } else {
    await moveOrder(tx, o, "delivered", { id: null, kind: "provider_webhook" }, {}, `transfer failed: ${event.failureReason ?? "unknown"}`);
  }
});
