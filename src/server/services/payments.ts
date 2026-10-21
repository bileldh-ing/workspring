import { and, eq, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { contracts, ledgerEntries, milestones, paymentIntents, providerWebhookEvents } from "@/db/schema";
import { AppError } from "@/domain/errors";
import type { Actor } from "@/domain/permissions";
import { assertTransition, paymentMachine } from "@/domain/state-machines";
import { getPaymentProvider, type PaymentProvider, type ProviderEvent } from "../payments";
import { signPayload, TEST_SIGNATURE_HEADER } from "../payments/test-provider";
import { completeContractIfDone, moveMilestone } from "./contracts";

/**
 * Ledger accounts (double entry, integer minor units, per currency):
 *  - provider_balance      asset: funds the provider reports as collected for the platform
 *  - milestone_payable     liability: collected for a milestone, owed onward until released
 *  - platform_fee_revenue  revenue: WorkSpring's fee, recognised at release
 * In TEST MODE every entry has mode='test' and represents no real money.
 */
type Leg = { account: string; direction: "debit" | "credit"; amountMinor: number };

async function postTransaction(
  tx: Executor,
  base: { mode: "test" | "live"; currency: string; contractId: string; milestoneId: string; paymentIntentId: string; memo: string },
  legs: Leg[],
) {
  const debits = legs.filter((l) => l.direction === "debit").reduce((a, l) => a + BigInt(l.amountMinor), 0n);
  const credits = legs.filter((l) => l.direction === "credit").reduce((a, l) => a + BigInt(l.amountMinor), 0n);
  if (debits !== credits) throw new Error(`Unbalanced ledger transaction: ${debits} != ${credits}`);
  const transactionId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values(legs.filter((l) => l.amountMinor > 0).map((l) => ({ ...base, ...l, transactionId })));
  return transactionId;
}

export type WebhookOutcome =
  | "applied"
  | "duplicate"
  | "unknown_intent"
  | "amount_mismatch"
  | "already_final"
  | "type_mismatch";

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

  return db.transaction(async (tx) => {
    // Serialize concurrent deliveries of the same event, then dedupe.
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
      // Minimal summary only: no raw payload retention.
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
  const isPayment = event.type.startsWith("payment.");
  if ((intent.purpose === "milestone_funding") !== isPayment) return "type_mismatch";
  const expectedAmount = intent.purpose === "milestone_release" ? intent.amountMinor - intent.feeMinor : intent.amountMinor;
  if (event.amountMinor !== expectedAmount || event.currency !== intent.currency) return "amount_mismatch";
  if (intent.status === "succeeded" || intent.status === "failed" || intent.status === "canceled") return "already_final";

  const succeeded = event.type.endsWith(".succeeded");
  const next = succeeded ? "succeeded" : "failed";
  assertTransition(paymentMachine, intent.status, next, "payment");
  await tx
    .update(paymentIntents)
    .set({ status: next, failureReason: succeeded ? null : (event.failureReason ?? "provider reported failure"), updatedAt: new Date() })
    .where(eq(paymentIntents.id, intent.id));

  const [m] = await tx.select().from(milestones).where(eq(milestones.id, intent.milestoneId)).for("update");
  const [c] = await tx.select().from(contracts).where(eq(contracts.id, m.contractId));
  const actor = { id: null, kind: "provider_webhook" as const };
  const base = { mode: intent.mode, currency: intent.currency, contractId: c.id, milestoneId: m.id, paymentIntentId: intent.id };

  if (intent.purpose === "milestone_funding") {
    if (succeeded) {
      await moveMilestone(tx, m, "funded", actor, { eventId: event.id, intentId: intent.id });
      await postTransaction(tx, { ...base, memo: `Milestone ${m.seq} funded (${intent.mode})` }, [
        { account: "provider_balance", direction: "debit", amountMinor: intent.amountMinor },
        { account: "milestone_payable", direction: "credit", amountMinor: intent.amountMinor },
      ]);
    } else {
      await moveMilestone(tx, m, "unfunded", actor, { eventId: event.id, reason: event.failureReason ?? null });
    }
  } else {
    if (succeeded) {
      await moveMilestone(tx, m, "released", actor, { eventId: event.id, intentId: intent.id });
      await postTransaction(tx, { ...base, memo: `Milestone ${m.seq} released (${intent.mode})` }, [
        { account: "milestone_payable", direction: "debit", amountMinor: intent.amountMinor },
        { account: "provider_balance", direction: "credit", amountMinor: intent.amountMinor - intent.feeMinor },
        { account: "platform_fee_revenue", direction: "credit", amountMinor: intent.feeMinor },
      ]);
      await completeContractIfDone(tx, c.id);
    } else {
      // Back to approved so the client can retry the release.
      await moveMilestone(tx, m, "approved", actor, { eventId: event.id, reason: event.failureReason ?? null });
    }
  }
  return "applied";
}

// ---------------------------------------------------------------- TEST MODE simulation

/** Builds a signed test-provider event body + headers for an intent (used by the test checkout page and tests). */
export function buildSignedTestEvent(
  intent: { providerRef: string | null; purpose: "milestone_funding" | "milestone_release"; amountMinor: number; feeMinor: number; currency: string },
  outcome: "succeeded" | "failed",
  secret: string,
  eventId = `evt_test_${crypto.randomUUID()}`,
) {
  const kind = intent.purpose === "milestone_funding" ? "payment" : "transfer";
  const body = JSON.stringify({
    id: eventId,
    type: `${kind}.${outcome}`,
    providerRef: intent.providerRef,
    amountMinor: intent.purpose === "milestone_release" ? intent.amountMinor - intent.feeMinor : intent.amountMinor,
    currency: intent.currency,
    created: Math.floor(Date.now() / 1000),
    ...(outcome === "failed" ? { failureReason: "Simulated failure (test provider)" } : {}),
  });
  const headers = new Headers({ "content-type": "application/json", [TEST_SIGNATURE_HEADER]: signPayload(body, secret) });
  return { body, headers, eventId };
}

/**
 * TEST MODE ONLY: lets a contract participant ask the simulated provider to emit an outcome.
 * The event is HMAC-signed and goes through the exact same verification + processing as an external webhook.
 */
export async function simulateTestProviderOutcome(db: DB, actor: Actor, intentId: string, outcome: "succeeded" | "failed") {
  const provider = getPaymentProvider();
  if (provider.id !== "test" || !provider.configured) throw new AppError("FORBIDDEN", "Simulation is only available with the test provider");
  const [row] = await db
    .select({ i: paymentIntents, c: contracts })
    .from(paymentIntents)
    .innerJoin(milestones, eq(milestones.id, paymentIntents.milestoneId))
    .innerJoin(contracts, eq(contracts.id, milestones.contractId))
    .where(eq(paymentIntents.id, intentId));
  if (!row || (row.c.clientId !== actor.userId && row.c.freelancerId !== actor.userId)) throw new AppError("NOT_FOUND", "Payment not found");
  const { body, headers } = buildSignedTestEvent(row.i, outcome, process.env.TEST_PROVIDER_WEBHOOK_SECRET!);
  return processWebhook(db, "test", body, headers, provider);
}

export async function getIntentForParticipant(db: Executor, actor: Actor, intentId: string) {
  const [row] = await db
    .select({ i: paymentIntents, m: milestones, c: contracts })
    .from(paymentIntents)
    .innerJoin(milestones, eq(milestones.id, paymentIntents.milestoneId))
    .innerJoin(contracts, eq(contracts.id, milestones.contractId))
    .where(eq(paymentIntents.id, intentId));
  if (!row || (row.c.clientId !== actor.userId && row.c.freelancerId !== actor.userId)) throw new AppError("NOT_FOUND", "Payment not found");
  return row;
}
