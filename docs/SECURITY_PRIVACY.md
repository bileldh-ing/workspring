# Security & privacy

Scope: the WorkSpring web app (Next.js 16 App Router, server actions + JSON API), PostgreSQL 17, private object storage, the simulated test payment provider and optional LiveKit video. Last reviewed with the code at the commit that added this file.

## Trust boundaries

1. **Browser ↔ app server**: everything from the browser is untrusted. Every page, server action and API route re-reads the session from the database (`getActorBySessionToken`) and every service function checks capability and ownership. `src/proxy.ts` only redirects cookie-less requests; it is not an authorization layer.
2. **App ↔ database**: parameterised queries only (Drizzle / tagged `sql`). Money is integer minor units. The ledger and event tables are append-only (DB triggers in `drizzle/0001_append_only_guards.sql`).
3. **Provider ↔ app**: payment state changes only on an HMAC-verified webhook (`/api/provider-webhooks/[provider]`), deduplicated by provider event id and checked for amount/type mismatches.
4. **App ↔ object storage**: files are stored outside `public/`; downloads go through `/api/files/[id]` with a short-lived HMAC-signed URL generated per viewer after an entity-level access check.

## Threat model (spec §18)

| Threat | Mitigation | Evidence |
|---|---|---|
| Broken object-level authorization / IDOR | Service-layer checks; foreign resources return `NOT_FOUND` (not 403) so ids can't be probed | `tests/integration/isolation.test.ts`, R2 tests (orders, tickets, agencies, files) |
| Account takeover | Argon2id hashes, DB sessions (httpOnly, SameSite=Lax, Secure in prod), sessions revoked on password reset and suspension; login/register/reset rate limits (8/10 min, 5/h, 5/h) | `src/server/services/auth.ts`, `src/server/rate-limit.ts` |
| Proposal / report spam | Verified email required to post, propose, offer or order; DB-backed rate limits on uploads (30/10 min) and reports (10/h); block list | `rate-limit.ts`, `safety.ts` |
| Malicious file upload | Extension + MIME allowlist, magic-byte sniffing, 10 MB/file, 5 files, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, SHA-256 recorded. **No antivirus scanning** (no scanner configured) | `src/domain/files.ts`, `src/server/services/files.ts` |
| XSS | React output encoding, no `dangerouslySetInnerHTML` for user content, CSP with `default-src 'self'` | `next.config.ts` headers |
| CSRF | Server actions are POST-only with Next.js origin checks; cookies are SameSite=Lax; JSON API requires the session cookie and same-origin | Next.js docs, `next.config.ts` |
| SQL injection | Parameterised queries only | code review |
| SSRF | The server never fetches user-supplied URLs | code review |
| Webhook replay / forgery | HMAC-SHA256 signature with timestamp tolerance, unique provider event id, idempotent handlers, out-of-order safe | `tests/unit/webhook-signature.test.ts`, `tests/integration/webhooks-and-concurrency.test.ts` |
| Race conditions (double accept, double fund) | Row locks (`for update`), partial unique indexes, transactions | concurrency tests |
| Fake reviews | Only parties to a **completed** contract/order may review, once each; double-blind reveal; moderation can hide (audited) but never edit ratings | `src/server/services/reviews.ts`, `r2-services-reviews.test.ts` |
| Payment fraud | Test mode only; no live provider is wired; amounts are server-computed from snapshots; fee rule versioned and snapshotted | `docs/PAYMENTS_AND_LEDGER.md` |
| Staff abuse | Least-privilege staff roles, every staff action audited (including support viewing a ticket), superadmins can't be suspended from the console, staff can't change their own status | `src/domain/admin.ts`, `src/server/services/admin.ts` |

## Access-control matrix (staff)

| Permission | superadmin | support | moderator | finance |
|---|:-:|:-:|:-:|:-:|
| users.read | ✓ | ✓ | ✓ | |
| users.suspend | ✓ | | ✓ | |
| roles.grant | ✓ | | | |
| moderation.services / moderation.reviews | ✓ | | ✓ | |
| reports.handle | ✓ | | ✓ | |
| support.handle | ✓ | ✓ | | |
| payments.read | ✓ | | | ✓ |
| disputes.resolve | ✓ | | | ✓ |
| audit.read | ✓ | | | ✓ |

Non-staff requests to `/admin/**` get 404 (the console isn't discoverable). Staff without a permission see a "not available for your staff role" notice and the service call is refused server-side.

## Agency boundaries

Agency members see each other's **public** profile fields only. Owners/admins can invite, remove (soft, keeps history) and (owner only) change roles. No agency role can read a member's credentials, messages, earnings or independent contracts; removal never touches the member's own account. Invitations go to an existing account by email without revealing whether the email exists.

## Logging & secrets

`src/lib/logger.ts` scrubs emails, tokens, cookies, passwords, card-like numbers and authorization headers. Message bodies are not logged. Secrets are read from environment variables validated at boot (`src/lib/env.ts`); production refuses to start without `FILE_URL_SECRET` and a database URL.

## Data retention (current build)

| Data | Retention | Notes |
|---|---|---|
| Accounts, profiles | until deletion request | deletion is a support request in this build (no self-service delete yet) |
| Messages | life of the account | edit/delete windows; deleted messages keep a tombstone |
| Files | life of the parent record | private; signed URLs expire in minutes |
| Ledger, payment intents, webhook summaries, audit log | append-only; keep for accounting (≥ 10 years is typical; confirm with counsel) | raw provider payloads are not stored |
| Sessions | 30 days or until logout/reset/suspension | |
| Time entries | life of the contract + accounting retention | see `TIME_TRACKING_PRIVACY.md` |

**Not built yet (planned):** self-service data export and account deletion, appeal workflow UI (appeals go through support tickets today), antivirus scanning, automated accessibility audit.

## Incident response (minimum)

1. Contain: suspend affected accounts from `/admin/users` (revokes sessions), rotate `FILE_URL_SECRET`/webhook secrets (invalidates signed URLs/webhooks).
2. Investigate with `/admin/audit`, `/admin/payments` and server logs (`/api/health`, structured JSON logs).
3. Notify affected users via support tickets/email and regulators where required (GDPR Art. 33: 72 h).
4. Post-mortem in the repository with the fix and a regression test.
