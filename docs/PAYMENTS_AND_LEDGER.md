# Payments and ledger

> **Status (R1, 2026-10-21): TEST MODE ONLY.** No real money can move through this build. WorkSpring does **not** provide escrow, payment protection or safeguarded funds, and never labels anything that way.

## Provider eligibility

| Provider | Finding | Source / date | Decision |
|---|---|---|---|
| Stripe (incl. Connect) | Tunisia is not in Stripe's supported-country list | https://stripe.com/global, fetched 2026-10-21 | Not used. A Tunisia-based platform entity can't hold a Stripe platform account |
| Others (PayPal, Payoneer, Flouci, Konnect, Wise, Paymee, etc.) | **Not researched in R1** | — | Phase 8: verify marketplace/split-payment support, KYC, payout rails, chargeback liability and legal structure for the actual platform entity before any live adapter |

Holding client money before release is regulated in most jurisdictions (e-money/payment-institution licensing or a licensed escrow partner). Until a provider product and legal structure exist, live funding/release stay **unconfigured**.

## Adapter interface

`src/server/payments/types.ts`

```ts
interface PaymentProvider {
  id: string; mode: "test" | "live"; configured: boolean; label: string; unavailableReason?: string;
  createPayment(input): Promise<{ providerRef; status: "requires_action" | "processing"; actionUrl? }>; // never "succeeded"
  createTransfer(input): Promise<{ providerRef; status: "processing" }>;
  verifyWebhook(rawBody: string, headers: Headers): ProviderEvent; // throws BAD_SIGNATURE
}
```

Selection (`getPaymentProvider()`): `PAYMENTS_PROVIDER=test` + `TEST_PROVIDER_WEBHOOK_SECRET` (≥32 chars) → test provider. Any other value (e.g. `stripe`) → **unconfigured**: every money call raises `PROVIDER_UNCONFIGURED` (HTTP 503), the UI hides fund/release buttons and shows the reason, the layout banner says "Payments are not configured", `/api/health` reports `configured:false`.

## Test provider

- `createPayment` returns `requires_action` and a checkout URL `/test-provider/checkout/<intentId>` (simulated provider page, banner-labelled, collects nothing).
- `createTransfer` returns `processing`.
- Outcomes are delivered as webhook events signed with HMAC-SHA256: header `x-workspring-test-signature: t=<unix>,v1=<hex(hmac(secret, "<t>.<rawBody>"))>`; 300-second tolerance; constant-time comparison; strict zod schema for the event body.
- The "Simulate succeeded/failed" buttons (participants only, test provider only) build and sign the event server-side, then pass it through the **same** `processWebhook` function as an external POST to `/api/provider-webhooks/test`.

Manual webhook example (dev):
```bash
BODY='{"id":"evt_manual_1","type":"payment.succeeded","providerRef":"tp_pay_<intentId>","amountMinor":70000,"currency":"USD","created":'$(date +%s)'}'
SIG=$(node -e "const c=require('crypto');const t=Math.floor(Date.now()/1000);console.log('t='+t+',v1='+c.createHmac('sha256',process.env.S).update(t+'.'+process.argv[1]).digest('hex'))" "$BODY")
curl -X POST localhost:3000/api/provider-webhooks/test -H "content-type: application/json" -H "x-workspring-test-signature: $SIG" -d "$BODY"
```
(`S` = your `TEST_PROVIDER_WEBHOOK_SECRET`.)

## Money state model

- Amounts: integer minor units (`bigint`) + ISO currency; parsing from strings without floats (`toMinor`); fees via BigInt basis points with half-up rounding (`feeMinor`); release split always sums to gross (`splitRelease`).
- Fee rule: `platform_fee_rules` (versioned). The active rule is copied into the offer `terms_snapshot` and contract `fee_rule_snapshot`; later rule changes never alter existing contracts. R1 default v1: 10% freelancer fee on release, 0% client fee.
- Payment intents: `requires_action|processing → succeeded|failed` (terminal). Idempotency keys `fund:<milestoneId>:<attempt>` / `release:<milestoneId>:<attempt>` (unique). Re-clicking "Fund" while a checkout is pending returns the same intent.

## Webhook processing (`src/server/services/payments.ts`)

1. Provider must match the route and be configured, else 404.
2. Signature + timestamp + schema verified **before any DB work** (400 `BAD_SIGNATURE`).
3. One transaction: `pg_advisory_xact_lock(hashtext(provider:event_id))` → if `(provider, event_id)` already in `provider_webhook_events` → `duplicate` (no-op).
4. Lock the payment intent by `(provider, provider_ref)`. Outcomes recorded without applying: `unknown_intent`, `type_mismatch`, `amount_mismatch` (amount/currency must equal our intent: gross for funding, net for transfers), `already_final` (out-of-order/late events).
5. Apply: update intent, move milestone (`actor_kind = provider_webhook`), post balanced ledger transaction, complete contract when all milestones are released.
6. Insert the event row (minimal summary, no raw payload).
Responses are `200 {data:{outcome,eventId}}` for every verified event so providers don't retry forever on business no-ops.

## Ledger

See `DATABASE.md` → Ledger design. Funding: Dr `provider_balance` / Cr `milestone_payable` (gross). Release: Dr `milestone_payable` (gross) / Cr `provider_balance` (net) / Cr `platform_fee_revenue` (fee). Unique `(payment_intent_id, account, direction)` blocks double-posting even if application-level dedupe failed; DB triggers make entries append-only.

## Not built (Phase 8)

Live provider adapters, payout onboarding/KYC, refunds, chargebacks/disputes, reconciliation runs against provider reports, invoices, client billing methods, payout status screens.
