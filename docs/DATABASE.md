# Database

PostgreSQL 17 is the system of record. Schema: `src/db/schema.ts` (Drizzle). Migrations (committed SQL): `drizzle/`.

| Migration | Contents |
|---|---|
| `drizzle/0000_init.sql` | All enums, 27 tables, FKs, CHECK constraints, B-tree/GIN indexes, partial unique indexes, generated `tsvector` columns |
| `drizzle/0001_append_only_guards.sql` | Custom: `workspring_forbid_mutation()` trigger function; append-only triggers on `ledger_entries` & `provider_webhook_events` (UPDATE/DELETE) and `milestone_events`, `contract_events`, `audit_log` (UPDATE); default fee rule v1 (10% freelancer fee, 0% client fee) |

## Procedures

```bash
pnpm db:start     # foreground real Postgres (embedded-postgres) using WS_PG_DATA / WS_PG_PORT
pnpm db:migrate   # apply drizzle/ migrations to DATABASE_URL
pnpm db:seed      # synthetic demo data (idempotent)
pnpm db:reset     # DEV ONLY: drop + recreate public schema, re-migrate (refuses NODE_ENV=production)
pnpm db:generate  # after editing src/db/schema.ts: generate a new SQL migration; review and commit it
```

Fresh setup = `db:start` (in another terminal) → `db:migrate` → `db:seed`. Tests create their own throwaway cluster (see `TESTING.md`).

## Entity overview

```
users ─┬─< user_capabilities          (client | freelancer | admin)
       ├─< sessions                   (id = sha256(token))
       ├─< email_tokens               (verify_email | reset_password; token_hash unique)
       ├── freelancer_profiles ─< profile_skills >─ skills >─ categories
       ├── client_profiles
       └─< jobs ─< job_skills >─ skills
               ├─< job_events
               └─< proposals ─< proposal_events
                        ├── conversations ─< conversation_members >─ users
                        │                 └─< messages
                        └─< offers ─< offer_events
                               └── contracts ─< contract_events
                                         └─< milestones ─< milestone_events
                                                ├─< milestone_submissions ─< revision_requests
                                                └─< payment_intents ─< ledger_entries
provider_webhook_events (provider, event_id) unique
platform_fee_rules (versioned)    email_outbox (dedupe_key unique)    audit_log
```

## Tables, constraints and indexes (summary)

| Table | Notable constraints / indexes |
|---|---|
| users | `users_email_lower_uq` unique on `lower(email)`; `is_demo` flag for seed rows |
| user_capabilities | PK (user_id, capability) |
| sessions | idx user_id, idx expires_at |
| email_tokens | unique token_hash; single-use via `used_at` |
| email_outbox | unique dedupe_key; idx status |
| audit_log | idx (entity_type, entity_id), idx actor_id; append-only (UPDATE blocked) |
| categories / skills | unique slug |
| freelancer_profiles | unique slug; CHECK rate > 0; generated `search_tsv` + GIN; idx status |
| jobs | unique slug; CHECK budgets > 0 and min ≤ max; generated `search_tsv` + GIN; idx (status, published_at), client_id, category_id |
| proposals | **partial unique (job_id, freelancer_id) WHERE status <> 'withdrawn'**; CHECK amount > 0; idx (job_id,status), (freelancer_id,status) |
| conversations | unique proposal_id (one thread per proposal) |
| conversation_members | PK (conversation_id, user_id); idx user_id |
| offers | **partial unique (proposal_id) WHERE status = 'sent'**; CHECK total > 0 |
| contracts | **unique offer_id**; **partial unique (job_id) WHERE status in ('active','paused')** (R1: one hire per job) |
| milestones | unique (contract_id, seq); CHECK amount > 0 |
| milestone_submissions | unique (milestone_id, version) |
| payment_intents | unique idempotency_key; unique (provider, provider_ref); CHECK amount > 0 |
| provider_webhook_events | unique (provider, event_id); append-only |
| ledger_entries | CHECK amount > 0; **unique (payment_intent_id, account, direction)**; idx transaction_id, contract_id; append-only |
| platform_fee_rules | unique version |

All money columns are `bigint` integer **minor units** with an ISO currency code column (USD/EUR: 2 decimals, TND: 3). All timestamps are `timestamptz` (UTC).

## Ledger design

Double entry, one `transaction_id` per posting, debits = credits enforced in code (`postTransaction`) and verified by integration tests. Accounts:

| Account | Type | Posted when |
|---|---|---|
| `provider_balance` | asset | debit on verified funding; credit (net) on verified release |
| `milestone_payable` | liability | credit on funding; debit (gross) on release |
| `platform_fee_revenue` | revenue | credit (fee) on release |

Each entry carries `mode` (`test`/`live`), contract, milestone and payment intent ids. Corrections must be compensating entries (UPDATE/DELETE are rejected by trigger). In test mode the ledger records simulated events only.

## Retention (planned)

Financial and audit records are append-only and retained; message/proposal retention and account-deletion handling are planned (Phase 9/10).
