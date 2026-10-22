import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { adminRoles, contracts, ledgerEntries, milestones, paymentIntents, providerWebhookEvents, serviceOrders, timesheets } from "@/db/schema";
import { AppError } from "@/domain/errors";
import type { Actor } from "@/domain/permissions";
import { assertTransition, paymentMachine } from "@/domain/state-machines";
import { getPaymentProvider, type PaymentProvider, type ProviderEvent } from "../payments";
import { signPayload, TEST_SIGNATURE_HEADER } from "../payments/test-provider";

/**
 * Ledger accounts (double entry, integer minor units, per currency):
 *  - provider_balance      asset: funds the provider reports as collected for the platform
 *  - milestone_payable     liability: collected for a milestone, owed onward until released or refunded
 *  - order_payable         liability: collected for a service order, owed onward until released
 *  - freelancer_payable    liability: approved hourly earnings owed to the freelancer (payouts are Phase 8)
 *  - platform_fee_revenue  revenue: WorkSpring's fee, recognised at release/settlement
 * In TEST MODE every entry has mode='test' and represents no real money.
 */
type Leg = { account: string; direction: "debit" | "credit"; amountMinor: number };
type Purpose = (typeof paymentIntents.$inferSelect)["purpose"];
export type Intent = typeof paymentIntents.$inferSelect;

export async function postTransaction(
  tx: Executor,
  base: { mode: "test" | "live"; currency: string; contractId: string | null; milestoneId: string | null; serviceOrderId?: string | null; paymentIntentId: string; memo: string },
  legs: Leg[],
) {
  const debits = legs.filter((l) => l.direction === "debit").reduce((a, l) => a + BigInt(l.amountMinor), 0n);
  const credits = legs.filter((l) => l.direction === "credit").reduce((a, l) => a + BigInt(l.amountMinor), 0n);
  if (debits !== credits) throw new Error(`Unbalanced ledger transaction: ${debits} != ${credits}`);
  const transactionId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values(legs.filter((l) => l.amountMinor > 0).map((l) => ({ ...base, serviceOrderId: base.serviceOrderId ?? null, ...l, transactionId })));
  return transactionId;
}

export type WebhookOutcome = "applied" | "duplicate" | "unknown_intent" | "amount_mismatch" | "already_final" | "type_mismatch";

/** Which provider event family settles each intent purpose. */
export const EVENT_KIND: Record<Purpose, "payment" | "transfer" | "refund"> = {
  milestone_funding: "payment",
  timesheet_payment: "payment",
  order_payment: "payment",
  milestone_release: "transfer",
  order_release: "transfer",
  milestone_refund: "refund",
};
/** Amount the provider moves for an intent: transfers carry the net (gross minus fee). */
export const expectedProviderAmount = (i: Pick<Intent, "purpose" | "amountMinor" | "feeMinor">) => (EVENT_KIND[i.purpose] === "transfer" ? i.amountMinor - i.feeMinor : i.amountMinor);

type Handler = (tx: Executor, intent: Intent, succeeded: boolean, event: ProviderEvent) => Promise<void>;
const handlers: Partial<Record<Purpose, Handler>> = {};

/** Domain modules register how a settled intent changes their records (keeps payments free of import cycles). */
export function registerPaymentHandler(purpose: Purpose, h: Handler) {
  handlers[purpose] = h;
}

/**
 * Verifies and applies a provider webhook. Safe against replays (same event id → no-op), retries,
 * and out-of-order delivery (terminal intents are never re-applied). Everything happens in one DB transaction.
 */
export async function processWebhook(
  db: DB,
  providerId: string,
  rawBody: string,
  headers: Headers,
  provider: PaymentProvider = getPaymentProvider(),
): Promise<{ outcome: WebhookOutcome; eventId: string }> {
  if (provider.id !== providerId || !provider.configured) throw new AppError("NOT_FOUND", "Unknown provider");
  const event = provider.verifyWebhook(rawBody, headers); // throws BAD_SIGNATURE before any DB work
  await ensureHandlersLoaded();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${provider.id}:${event.id}`}))`);
    const [seen] = await tx
      .select({ id: providerWebhookEvents.id })
      .from(providerWebhookEvents)
      .where(and(eq(providerWebhookEvents.provider, provider.id), eq(providerWebhookEvents.eventId, event.id)));
    if (seen) return { outcome: "duplicate" as const, eventId: event.id };

    const outcome = await applyEvent(tx, provider, event);
    await tx.insert(providerWebhookEvents).values({
      provider: provider.id,
      eventId: event.id,
      type: event.type,
      outcome,
      summary: { providerRef: event.providerRef, amountMinor: event.amountMinor, currency: event.currency, failureReason: event.failureReason ?? null },
    });
    return { outcome, eventId: event.id };
  });
}

async function applyEvent(tx: Executor, provider: PaymentProvider, event: ProviderEvent): Promise<WebhookOutcome> {
  const [intent] = await tx
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.provider, provider.id), eq(paymentIntents.providerRef, event.providerRef)))
    .for("update");
  if (!intent) return "unknown_intent";
  if (!event.type.startsWith(`${EVENT_KIND[intent.purpose]}.`)) return "type_mismatch";
  if (event.amountMinor !== expectedProviderAmount(intent) || event.currency !== intent.currency) return "amount_mismatch";
  if (intent.status === "succeeded" || intent.status === "failed" || intent.status === "canceled") return "already_final";

  const succeeded = event.type.endsWith(".succeeded");
  const next = succeeded ? "succeeded" : "failed";
  assertTransition(paymentMachine, intent.status, next, "payment");
  await tx
    .update(paymentIntents)
    .set({ status: next, failureReason: succeeded ? null : (event.failureReason ?? "provider reported failure"), updatedAt: new Date() })
    .where(eq(paymentIntents.id, intent.id));
  const h = handlers[intent.purpose];
  if (!h) throw new Error(`No payment handler registered for ${intent.purpose}`);
  await h(tx, intent, succeeded, event);
  return "applied";
}

let loaded: Promise<unknown> | null = null;
/** Lazily imports the modules that register handlers (contracts, hourly, orders, disputes). */
export function ensureHandlersLoaded() {
  loaded ??= Promise.all([import("./contracts"), import("./hourly"), import("./orders"), import("./disputes")]);
  return loaded;
}

/** Creates a payment intent row for a provider money movement. Idempotency key: `${prefix}:${targetId}:${attempt}`. */
export async function createIntent(
  tx: Executor,
  provider: PaymentProvider,
  input: { purpose: Purpose; target: { milestoneId?: string; timesheetId?: string; serviceOrderId?: string }; amountMinor: number; feeMinor?: number; currency: string; description: string; createdBy: string | null; paymentRef?: string | null },
) {
  const targetId = input.target.milestoneId ?? input.target.timesheetId ?? input.target.serviceOrderId!;
  const [{ attempts }] = await tx.execute<{ attempts: number }>(
    sql`select count(*)::int as attempts from payment_intents where purpose = ${input.purpose} and coalesce(milestone_id, timesheet_id, service_order_id) = ${targetId}`,
  );
  const intentId = crypto.randomUUID();
  const idempotencyKey = `${input.purpose}:${targetId}:${Number(attempts) + 1}`;
  const fee = input.feeMinor ?? 0;
  const movement = { intentId, amountMinor: EVENT_KIND[input.purpose] === "transfer" ? input.amountMinor - fee : input.amountMinor, currency: input.currency, idempotencyKey, description: input.description };
  const kind = EVENT_KIND[input.purpose];
  const res = kind === "payment" ? await provider.createPayment(movement) : kind === "transfer" ? await provider.createTransfer(movement) : await provider.createRefund({ ...movement, paymentRef: input.paymentRef ?? null });
  await tx.insert(paymentIntents).values({
    id: intentId,
    provider: provider.id,
    mode: provider.mode,
    providerRef: res.providerRef,
    purpose: input.purpose,
    milestoneId: input.target.milestoneId ?? null,
    timesheetId: input.target.timesheetId ?? null,
    serviceOrderId: input.target.serviceOrderId ?? null,
    amountMinor: input.amountMinor,
    feeMinor: fee,
    currency: input.currency,
    status: res.status,
    idempotencyKey,
    createdBy: input.createdBy,
  });
  return { intentId, actionUrl: "actionUrl" in res ? (res.actionUrl ?? null) : null };
}

// ---------------------------------------------------------------- TEST MODE simulation

/** Builds a signed test-provider event body + headers for an intent (used by the test checkout page and tests). */
export function buildSignedTestEvent(
  intent: Pick<Intent, "providerRef" | "purpose" | "amountMinor" | "feeMinor" | "currency">,
  outcome: "succeeded" | "failed",
  secret: string,
  eventId = `evt_test_${crypto.randomUUID()}`,
) {
  const body = JSON.stringify({
    id: eventId,
    type: `${EVENT_KIND[intent.purpose]}.${outcome}`,
    providerRef: intent.providerRef,
    amountMinor: expectedProviderAmount(intent),
    currency: intent.currency,
    created: Math.floor(Date.now() / 1000),
    ...(outcome === "failed" ? { failureReason: "Simulated failure (test provider)" } : {}),
  });
  const headers = new Headers({ "content-type": "application/json", [TEST_SIGNATURE_HEADER]: signPayload(body, secret) });
  return { body, headers, eventId };
}

/** Resolves who is party to an intent and where its UI lives. */
async function intentContext(db: Executor, i: Intent) {
  if (i.milestoneId) {
    const [r] = await db.select({ m: milestones, c: contracts }).from(milestones).innerJoin(contracts, eq(contracts.id, milestones.contractId)).where(eq(milestones.id, i.milestoneId));
    return { clientId: r.c.clientId, freelancerId: r.c.freelancerId, label: `Milestone ${r.m.seq}: ${r.m.title}`, back: `/app/contracts/${r.c.id}` };
  }
  if (i.timesheetId) {
    const [r] = await db.select({ t: timesheets, c: contracts }).from(timesheets).innerJoin(contracts, eq(contracts.id, timesheets.contractId)).where(eq(timesheets.id, i.timesheetId));
    return { clientId: r.c.clientId, freelancerId: r.c.freelancerId, label: `Timesheet for the week of ${r.t.weekStart}`, back: `/app/contracts/${r.c.id}` };
  }
  const [o] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, i.serviceOrderId!));
  return { clientId: o.buyerId, freelancerId: o.sellerId, label: `Service order: ${o.title}`, back: `/app/orders/${o.id}` };
}

async function isFinanceStaff(db: Executor, userId: string) {
  const r = await db.select().from(adminRoles).where(and(eq(adminRoles.userId, userId), inArray(adminRoles.role, ["superadmin", "finance"])));
  return r.length > 0;
}

export async function getIntentForParticipant(db: Executor, actor: Actor, intentId: string) {
  const [i] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId));
  if (!i) throw new AppError("NOT_FOUND", "Payment not found");
  const ctx = await intentContext(db, i);
  const party = ctx.clientId === actor.userId || ctx.freelancerId === actor.userId;
  if (!party && !(i.purpose === "milestone_refund" && (await isFinanceStaff(db, actor.userId)))) throw new AppError("NOT_FOUND", "Payment not found");
  return { i, ...ctx };
}

/**
 * TEST MODE ONLY: lets a party ask the simulated provider to emit an outcome. The event is HMAC-signed and goes
 * through the exact same verification + processing as an external webhook.
 */
export async function simulateTestProviderOutcome(db: DB, actor: Actor, intentId: string, outcome: "succeeded" | "failed") {
  const provider = getPaymentProvider();
  if (provider.id !== "test" || !provider.configured) throw new AppError("FORBIDDEN", "Simulation is only available with the test provider");
  const row = await getIntentForParticipant(db, actor, intentId);
  const { body, headers } = buildSignedTestEvent(row.i, outcome, process.env.TEST_PROVIDER_WEBHOOK_SECRET!);
  const r = await processWebhook(db, "test", body, headers, provider);
  return { ...r, back: row.back };
}
