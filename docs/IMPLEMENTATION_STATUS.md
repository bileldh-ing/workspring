# Implementation status

Last updated: 2026-10-21 (R1). "Done" means it can be navigated, is persisted, authorized, validated and tested, as the spec's definition of done requires. Evidence points to code and tests. Test results are in `TESTING.md`.

Legend: ✅ done (tested) · 🟡 partial (works; the gaps are listed) · ⏳ planned (not built) · ⛔ blocked

## Phase 0: audit & architecture

| Item | Status | Evidence |
|---|---|---|
| Dated public reference audit (11 official help articles + Stripe availability) | ✅ | `docs/REFERENCE_PRODUCT_AUDIT.md` |
| Tech decisions with exact versions | ✅ | `docs/TECH_DECISIONS.md`, `pnpm-lock.yaml` |
| Architecture / data model / API / lifecycle docs | ✅ | `docs/ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `CONTRACT_LIFECYCLE.md` |
| Threat model / SECURITY_PRIVACY.md, PRODUCT_REQUIREMENTS.md, DEPLOYMENT.md, user guides | ⏳ | Not written in R1 (security notes are in ARCHITECTURE/API/PAYMENTS) |

## Phase 1: foundation

| Item | Status | Evidence |
|---|---|---|
| Next.js 16 App Router + TS + Tailwind 4 + Drizzle; committed SQL migrations | ✅ | `drizzle/0000_init.sql`, `drizzle/0001_append_only_guards.sql` |
| Real Postgres for dev/tests (embedded-postgres 17.10) | ✅ | `scripts/pg.ts`, `tests/global-setup.ts` |
| Original brand / design tokens / accessible components | 🟡 | `src/app/globals.css`, `src/components/ui.tsx`, `logo.tsx`. Skip link, focus rings, labelled fields, `role=alert` errors, reduced-motion, semantic tables. **No automated a11y audit yet** |
| App shell: public nav + client/freelancer workspaces | ✅ | `src/components/site-header.tsx`, `src/app/app/layout.tsx` |
| Email + password auth (Argon2id), DB-backed httpOnly sessions, logout | ✅ | `src/server/services/auth.ts`; `tests/integration/auth.test.ts` |
| Email verification + password reset via `email_outbox` + dev viewer | ✅ | `/verify-email`, `/reset-password`, `/dev/outbox`; auth tests; HTTP flow test |
| One identity with client + freelancer capabilities, mode switching | ✅ | `addCapability`, `switchMode`; auth test "one identity…" |
| Server-side role authorization in the service layer; NOT_FOUND on foreign resources | ✅ | `src/domain/permissions.ts`; `tests/integration/isolation.test.ts` |
| zod validation, consistent error envelope | ✅ | `src/domain/validation.ts`, `src/domain/errors.ts`, `src/lib/api.ts` |
| Synthetic demo seed (flagged + labelled) | ✅ | `scripts/seed.ts`; "Synthetic demo" badges |
| CI pipeline | ⏳ | No CI config yet (commands documented in TESTING.md) |
| Supabase/RLS | ⏳ (by decision) | Not using Supabase; app-layer authz + tests. RLS as defence-in-depth later |
| Login throttle | 🟡 | In-memory, per process (`src/app/actions/auth.ts`); not shared across instances |

## Phases 2–5: minimal real slice

| Item | Status | Evidence / gaps |
|---|---|---|
| Freelancer profile create/edit/publish/hide, skills from taxonomy | ✅ | `/app/profile`, `PUT /api/freelancer-profile`; flow + HTTP tests |
| Public SSR profile page (no email, real completed-contract count only) | ✅ | `/freelancers/[slug]`; flow test asserts no email and a real count |
| Talent search (FTS + skill/level/rate filters, pagination) | ✅ | `/talent`, `searchTalent`; flow test |
| Job post: draft → open → paused → open → closed, edit, contact-detail heuristic | ✅ | `/app/jobs/new`, `/app/jobs/[id]`; state-machine unit tests; isolation tests |
| Job search: Postgres FTS (`tsvector` + GIN), category/skill/type/level/min-budget filters, sort, pagination, URL state | ✅ | `/jobs`, `GET /api/jobs`; flow + HTTP tests |
| Proposal submit (cover letter, bid/rate, duration, terms snapshot), withdraw, shortlist, decline with reason | ✅ | `/app/apply/[jobId]`, `/app/proposals/[id]`; tests |
| Proposal screening questions, attachments, profile highlights, editing with revision history | ⏳ | Phase 3 |
| Client views proposals; private persisted conversations (membership-checked), unread counts | ✅ | `/app/messages`; isolation test "conversations cannot be read or joined by guessing" |
| Message attachments, edit/delete windows, block/report, realtime push | ⏳ | Phase 4. Messages refresh on navigation/post (no websockets) |
| Offer (fixed price, 1–10 milestones, snapshot incl. fee rule, 14-day expiry), withdraw, decline | ✅ | `/app/offers/[id]`; tests |
| Accept offer: transaction + row locks + partial unique indexes, single live contract | ✅ | concurrency tests (two offers / same offer ×3) |
| Contract workroom: milestones, deliveries (versioned), revision requests, approval, event history, ledger view | ✅ | `/app/contracts/[id]`; flow test |
| Funding via test provider; state changes **only** on a verified webhook | ✅ | `fundMilestone`, `processWebhook`; webhook tests; HTTP test |
| Release via provider transfer + webhook; ledger (integer minor units, balanced, append-only) | ✅ | flow test ledger assertions; DB trigger test |
| Webhook HMAC verification, replay/duplicate idempotency, out-of-order safety, amount mismatch guard | ✅ | `tests/unit/webhook-signature.test.ts`, `tests/integration/webhooks-and-concurrency.test.ts` |
| Unconfigured live provider = explicit refusal, never fake success | ✅ | test "unconfigured provider refuses…"; UI notices |
| Hourly offers/contracts | ⏳ | Hourly jobs can be posted; offers are blocked with an explanation (Phase 6) |
| Interviews / video | ⏳ | Phase 4 |
| Invitations to apply | ⏳ | Phase 3 |
| Notifications center / email delivery (SMTP) / background worker | ⏳ | Outbox rows queue but are never delivered |

## Later phases: not built (Planned)

| Area | Phase |
|---|---|
| Hourly contracts, web timer, time diary, weekly timesheets, disputes on hours | 6 |
| Services catalog (tiers, add-ons, requirements, moderation, orders), consultations | 7 |
| Live payment provider(s), payout onboarding/KYC, refunds, chargebacks, disputes, reconciliation, invoices | 8 |
| Reviews & reputation, agencies & roles, company teams, identity/business verification, support tickets, abuse reports, moderation, admin console & audited admin actions | 9 |
| Private object storage + signed URLs for attachments/deliverables | 3–5 follow-up |
| CI, security review, accessibility audit, performance/SLOs, deployment docs, backup/restore | 10 |
| Saved jobs/searches/talent lists, recommendations, AI assistants | 2 / optional |

## Blockers and environment limits (this run)

| Blocker | Evidence | Next step |
|---|---|---|
| **Playwright e2e not added** | The sandbox is shared with other workloads, and available RAM repeatedly fell below 200 MB, so the OOM killer ended our dev server, `next build`, eslint and the DB process several times. Downloading and running Chromium (~170 MB on a RAM-backed root FS, plus ~300 MB RSS) was judged likely to fail the same way. | Run `pnpm add -D @playwright/test && pnpm exec playwright install chromium` on a normal machine/CI. The HTTP flow test (`tests/http/api-flow.mjs`) covers the same main path over real HTTP in the meantime |
| `next build` OOM-killed on several attempts | Exit 137 / SIGKILL in build logs. It succeeded with `--webpack`, 1 build CPU and the in-build type-check skipped (`WS_SKIP_BUILD_TYPECHECK=1`; `pnpm typecheck` passes separately) | Build on a machine with ≥ 4 GB free RAM; the default `pnpm build` (Turbopack + type-check) should then work |
| Dev server (`next dev`, Turbopack) OOM-killed when compiling pages | `/api/health` answered 200, then the process was killed | Pages were verified against the production server (`next start`) instead |
| Sandbox restarts wiped `/tmp` (dev DB data) and once lost an unflushed git commit | — | Re-ran migrate + seed; re-committed |
