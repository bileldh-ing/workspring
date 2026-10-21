# Architecture (R1)

```
Browser ──HTML/RSC──▶ Next.js App Router (src/app)
   │                    ├─ Server Components (SSR pages: /, /jobs, /jobs/[slug], /talent, /freelancers/[slug], /app/**)
   │                    ├─ Server Actions (src/app/actions/*.ts)  ── form posts, Origin-checked by Next.js
   │                    └─ Route Handlers (src/app/api/**)        ── JSON API, same-origin check for mutations
   │                                     │
   │                                     ▼
   │                  Service layer (src/server/services/*)  ◀── the ONLY place business rules + authorization live
   │                    auth · profiles · jobs · proposals · messaging · contracts · payments · outbox · audit
   │                         │                 │
   │                         │                 └──▶ Payment adapter (src/server/payments)
   │                         │                        ├─ test provider (TEST MODE, HMAC webhooks)
   │                         │                        └─ unconfigured (any live provider name) → PROVIDER_UNCONFIGURED
   │                         ▼
   │                  Domain (src/domain): money (minor units, BigInt fees), state machines, permissions, zod schemas, errors
   │                         │
   │                         ▼
   │                  Drizzle ORM (src/db/schema.ts) ──▶ PostgreSQL 17 (embedded-postgres in dev/test)
   │
Provider ──POST signed webhook──▶ /api/provider-webhooks/[provider] ──▶ payments.processWebhook (verify → dedupe → apply → ledger)
```

## Service boundaries

| Module | Responsibility | Key invariants |
|---|---|---|
| `auth` | register, login/logout, sessions, email verification, password reset, capabilities, mode switch | one identity per email (case-insensitive unique index); tokens stored hashed; reset revokes sessions |
| `profiles` | freelancer profile CRUD, publish/hide, public profile, talent search | publish requires verified email + complete profile; public view never exposes email |
| `jobs` | job CRUD, state transitions, public detail, job search | only owner can read drafts/edit/transition; only `open` jobs are searchable |
| `proposals` | submit, withdraw, shortlist/decline, read | one non-withdrawn proposal per freelancer per job (partial unique index); readable only by author or job owner |
| `messaging` | proposal conversations, messages, read markers | every read/write checks `conversation_members`; 20 msgs/min/user throttle |
| `contracts` | offers (create/accept/decline/withdraw/expire), contracts, milestones (fund/deliver/revise/approve/release) | single live contract per job (partial unique) + row locks; milestone transitions via state machine with event rows |
| `payments` | webhook verification + idempotent processing, double-entry ledger, test-mode simulation | signature checked before DB work; advisory lock + dedupe table; ledger append-only (DB trigger) |
| `outbox` | queue emails idempotently | unique `dedupe_key` |
| `audit` | append-only audit log | DB trigger blocks UPDATE |

## Trust boundaries

1. **Browser → server**: all input is untrusted; zod validation in the service layer; amounts parsed from strings to integers without floats.
2. **Session cookie → actor**: `getActorBySessionToken` hashes the cookie value and joins `sessions`/`users`; suspended users resolve to no actor.
3. **Actor → resource**: ownership/membership checks inside each service function; denial looks like `NOT_FOUND`.
4. **Provider → webhook endpoint**: unauthenticated network caller; trusted only after HMAC verification over the raw body, timestamp tolerance, schema validation, and amount/currency match against our own payment intent.
5. **Test-mode simulation**: the "simulate outcome" action is restricted to contract participants and to the `test` provider; it signs an event with the server-side secret and feeds it through the same `processWebhook` path.

## Request flow example: funding a milestone

1. Client clicks **Fund** → `milestoneAction(op=fund)` → `contracts.fundMilestone`.
2. Transaction: lock milestone row, check role=client, contract active, order rule, state `unfunded → funding_pending`; call `provider.createPayment` (test: returns `requires_action` + checkout URL); insert `payment_intents` with idempotency key `fund:<milestone>:<attempt>`; insert `milestone_events`.
3. Redirect to the provider checkout (test: `/test-provider/checkout/<intent>`).
4. Provider sends `payment.succeeded` webhook → `processWebhook`: verify signature → advisory lock on event id → dedupe → lock intent → validate amount/currency/state → intent `succeeded`, milestone `funded` (actor_kind `provider_webhook`) → ledger debit `provider_balance` / credit `milestone_payable` → record event row.

## Not in R1

Realtime transport (messages refresh on navigation/post), object storage, background job runner (outbox is queued but not delivered), admin console, agencies, hourly, services catalog. See `IMPLEMENTATION_STATUS.md`.
