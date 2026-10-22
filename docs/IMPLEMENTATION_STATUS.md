# Implementation status

Last updated: 2026-10-22 (v1.0.0). "Done" means the feature can be used in the UI, is stored in PostgreSQL, is checked for authorization and validated on the server, and is covered by tests (the spec's definition of done). Test counts and run links are in [`TESTING.md`](TESTING.md).

Legend: ✅ done (tested) · 🟡 partial (works; gaps listed) · ⏳ not built · ⛔ blocked by something outside the code

## Foundation

| Item | Status | Evidence / gaps |
|---|---|---|
| Next.js 16 App Router, TypeScript, Tailwind 4, Drizzle; 4 committed SQL migrations | ✅ | `drizzle/0000`–`0003` |
| Real Postgres 17 for dev and tests (embedded locally, `postgres:17` in CI) | ✅ | `scripts/pg.ts`, `tests/global-setup.ts`, `ci.yml` |
| Email + password auth (Argon2id), DB sessions (httpOnly), verify email, reset password | ✅ | `auth.test.ts`, HTTP smoke flow |
| One identity with client + freelancer capabilities, mode switching | ✅ | `auth.test.ts` |
| Authorization in the service layer; NOT_FOUND for foreign resources | ✅ | `isolation.test.ts` (7 tests) |
| Rate limiting (DB-backed, shared across instances; memory driver for single-process/CI) on auth and sensitive actions | ✅ | `src/server/rate-limit*`, per-IP login bucket 30/10 min |
| Security headers + CSP, PII-scrubbing logger, env validation at boot, `/api/health`, `/api/ready` | ✅ | `docs/SECURITY_PRIVACY.md` |
| Accessible components (labels, focus, skip link, reduced motion, semantic tables) | 🟡 | Playwright uses role/label locators throughout. **No automated a11y audit** |
| Synthetic demo seed (flagged `is_demo`, `[Demo]` names, UI badges) | ✅ | `scripts/seed.ts` |

## Marketplace

| Item | Status | Evidence / gaps |
|---|---|---|
| Freelancer profile (skills from taxonomy, publish/hide), public SSR page with no email, real completed-contract count, reviews, services | ✅ | flow tests, e2e |
| Job posts: draft → open → paused → closed, up to 5 screening questions, contact-detail heuristic | ✅ | state-machine tests, e2e |
| Search for jobs, talent and services (Postgres FTS + GIN, filters, sort, pagination, URL state) | ✅ | IT + e2e |
| Invitations to apply (14-day expiry, decline/revoke) | ✅ | `r2-proposals-messaging.test.ts` |
| Proposals: bid/rate, screening answers, attachments, withdraw, shortlist, decline with reason, terms snapshot | ✅ | IT + e2e |
| Messaging: membership-checked conversations, attachments, edit/delete windows, block/report, unread counts | 🟡 | IT. **No realtime push**: messages appear on navigation or after sending |
| Interviews: propose/accept/decline/cancel, UTC stored, `.ics` download | ✅ | IT |
| Video interviews (LiveKit) | 🟡 | Token signing is tested; video only works when the `LIVEKIT_*` keys are set. Without them the UI says "video not configured". Not configured in any deployment |
| Offers: fixed (1–10 milestones) or hourly (rate, weekly limit, manual-time flag), 14-day expiry; accepting creates exactly one contract | ✅ | concurrency tests, e2e (fixed + hourly) |
| Fixed-price milestones: fund → deliver (versioned) → revise → approve → release; states change only on verified provider webhooks | ✅ | IT + e2e main path |
| Hourly contracts: web timer, manual entries (when allowed, labelled), weekly limit, weekly timesheets, approve/dispute/resubmit, payment on webhook, end contract | ✅ | `r2-hourly.test.ts`, e2e hourly |
| Services catalog: 3 tiers, add-ons, requirements, max concurrent orders, moderation, orders with delivery/revisions/approval | ✅ | `r2-services-reviews.test.ts`, e2e services + admin |
| Reviews: completed contracts/orders only, once each, double-blind reveal (both submitted or 14 days), moderation | ✅ | IT |
| Agencies: one owned agency, public page, invites, roles, removal/leave with history kept | ✅ | IT |
| Notifications centre with unread badge; per-category preferences (payments & safety always in-app) | ✅ | IT |
| Email delivery | 🟡 | Emails are queued in `email_outbox` and visible at `/dev/outbox`. **No SMTP transport** is wired |
| Support tickets with attachments; disputes with staff resolution (release or refund, refund only on webhook) | ✅ | IT |
| Admin console: overview, users (suspend/reinstate, roles), moderation, reviews, reports, support queue, payments & webhook log, disputes, audit log; staff roles; every action audited; non-staff get 404 | ✅ | IT + e2e admin |
| Private file storage (local or S3-compatible), short-lived signed URLs bound to the user | ✅ | IT; S3 SigV4 unit-tested, not run against a real bucket |

## Payments and money

| Item | Status | Evidence / gaps |
|---|---|---|
| Double-entry ledger, integer minor units, append-only (DB triggers), versioned fee rules snapshotted on offers/contracts | ✅ | ledger assertions in IT, trigger test |
| Test provider: hosted checkout simulation, HMAC-signed webhooks, replay/out-of-order/amount-mismatch protection | ✅ | `webhooks-and-concurrency.test.ts` |
| Live payment provider, payouts, KYC, invoices, tax documents | ⏳ | By design for this build: an unconfigured provider refuses explicitly and never fakes success. Stripe is not available to a Tunisia-based platform (see `PAYMENTS_AND_LEDGER.md`) |
| Escrow / payment protection | ⏳ | **Not offered.** The UI says so on every contract |

## Delivery

| Item | Status | Evidence / gaps |
|---|---|---|
| CI: lint, typecheck, Vitest on Postgres 17 with coverage, production build, HTTP smoke, Playwright Chromium | ✅ | `ci.yml`; green run [39724354883](https://github.com/bileldh-ing/workspring/actions/runs/39724354883) |
| Security workflow: CodeQL, `pnpm audit` (prod deps, high/critical), dependency review | ✅ | `security.yml`, green on every recent push |
| Docker image (multi-stage standalone), docker-compose | ✅ | `Dockerfile`; `release.yml` publishes `ghcr.io/bileldh-ing/workspring` on `v*` tags |
| PWA: manifest, icons, service worker, offline page | ✅ | `public/`, `/offline` |
| Android: Capacitor shell, debug APK built in CI | 🟡 | `mobile.yml` uploads `workspring-debug-apk`. The shell loads a deployed web URL, and **no public deployment exists yet**. Signed AAB needs signing secrets (not set). No device tests |
| iOS | ⏳ | Capacitor dependency present; no iOS build in CI (needs macOS runner + Apple account) |
| Production deployment (Fly.io) | ⛔ | `deploy.yml` exists but skips (green, with a notice) because `FLY_API_TOKEN` is not set. Nothing is publicly hosted |
| Standalone linux-arm64 bundle (for ARM hosts that can't build) | ✅ | `build-arm64.yml` (manual) |

## Not built (non-goals for this build)

Live payments/payouts/KYC, identity verification badges, AI features, company teams for clients, saved searches and talent lists, consultations, invoices/tax documents, native push notifications, realtime messaging, automated accessibility audit, load testing.

## Environment notes

- The development sandbox has under 1 GB of free RAM at times. Local `next build` needs `--webpack`, one build worker and the in-build typecheck skipped (`pnpm build:low-mem`); CI builds with the default settings. The arm64 standalone workflow exists for this case.
- Sandbox restarts wipe `/tmp` (local DB data). Recovery is `pnpm db:start`, `pnpm db:migrate`, `pnpm db:seed`, then start the server (`LOCAL_SETUP.md`).
