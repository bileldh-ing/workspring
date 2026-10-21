# Contract lifecycle (R1)

All transitions are defined in `src/domain/state-machines.ts`, enforced in the service layer inside DB transactions with row locks, and recorded as event rows with the actor (`*_events` tables; `actor_kind` = `user` | `provider_webhook` | `system`). Invalid transitions return `409 INVALID_TRANSITION`.

## Job

```
draft ──publish──▶ open ──pause──▶ paused ──reopen──▶ open
  │                 │                 │
  └──close──────────┴──close──────────┴──▶ closed (terminal)
```
- Only the owning client. Publishing requires a verified email.
- Accepting an offer closes the job automatically (R1 jobs hire one freelancer); event recorded with the freelancer as actor.

## Proposal

```
submitted ⇄ shortlisted
   │  │          │
   │  └──────────┴──▶ offer_sent ──accept──▶ hired (terminal)
   │                     │  └── offer withdrawn/expired ──▶ shortlisted
   │                     └── offer declined ──▶ withdrawn
   ├──▶ declined (client, optional reason; terminal)
   └──▶ withdrawn (freelancer; terminal; may re-apply with a NEW proposal)
```
- One non-withdrawn proposal per freelancer per job (DB partial unique index).
- Terms (`rate_type`, `amount_minor`, `currency`, duration, cover letter) are stored with an immutable `terms_snapshot`.
- Withdraw is blocked while an offer is pending (decline the offer instead).
- Editing a submitted proposal is **not** supported in R1.

## Offer

```
sent ──▶ accepted | declined | withdrawn | expired   (all terminal)
```
- Fixed-price only in R1; 1–10 milestones; total = sum of milestones (integer minor units).
- Snapshot includes parties, scope, milestones, currency, **fee rule version**, payment mode, policy text, expiry (14 days).
- At most one `sent` offer per proposal (partial unique index). "Modify" = withdraw + send a new offer.
- Expiry is enforced at acceptance time: an expired offer is marked `expired` and its proposal returns to `shortlisted`.

## Acceptance → contract (concurrency)

`acceptOffer` runs in one transaction: `SELECT … FOR UPDATE` on the job, then the offer, then the proposal; checks state and expiry; inserts the contract (unique `offer_id`; partial unique "one live contract per job"); copies milestones from the snapshot; closes the job. Concurrent accepts of two offers on the same job, or the same offer three times, yield exactly one contract (tested).

## Contract

```
active ──▶ paused ──▶ active
  │           │
  ├──▶ completed (automatic when every non-canceled milestone is released)
  └──▶ canceled  (planned UI; not exposed in R1)
```

## Milestone (fixed price) — work state and payment state are separate

```
unfunded ──client: fund──▶ funding_pending ──webhook payment.succeeded──▶ funded
    ▲                            │
    └──webhook payment.failed────┘
funded ──freelancer: deliver──▶ submitted ──client: approve──▶ approved ──(auto) request release──▶ release_pending
                                  │  ▲                                ▲                                  │
              client: revision ───┘  └── freelancer: resubmit         └──webhook transfer.failed─────────┤
                     ▼                                                    (client may "Retry release")    │
             revision_requested                                                                          ▼
                                                                         webhook transfer.succeeded──▶ released
```
- `funded` and `released` can **only** be reached from a verified provider webhook.
- Milestones must be funded in order (`canFundInOrder`).
- No delivery before funding.
- Each delivery is a numbered `milestone_submissions` version; each revision request references the submission it rejects.
- Payment intents have their own machine: `requires_action|processing → succeeded|failed` (terminal). Late or duplicate webhooks for a terminal intent are ignored (`already_final`).

## Not implemented yet

Hourly contracts and time diary (Phase 6), contract amendments, pause/cancel UI, disputes/refunds (Phase 8), automatic review-window auto-approval, interviews (Phase 4).
