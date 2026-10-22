# Testing

Every number on this page comes from a real GitHub Actions run, linked below. Nothing here is estimated.

**Reference run:** CI run [39724354883](https://github.com/bileldh-ing/workspring/actions/runs/39724354883) on commit `fda9fb0` (2026-10-22): all three jobs passed. Later commits change only docs, screenshots and one notice string, and CI on them is recorded in the table at the end of this page.

## Summary

| Layer | Tool | Where it runs | Result in the reference run |
|---|---|---|---|
| Lint + types | ESLint 9, `tsc --noEmit` | CI job "Lint & typecheck" | pass, 0 errors |
| Unit tests | Vitest 5 | CI job "Unit + integration tests" | **5 files, 43 tests, all pass** |
| Integration tests | Vitest 5 against **real PostgreSQL 17** (`postgres:17` service; embedded Postgres locally) | same job | **9 files, 42 tests, all pass** |
| Total Vitest | | | **14 files, 85 tests passed, 0 failed, 0 skipped** |
| Coverage (`src/domain`, `src/server`, v8) | `vitest --coverage` | same job | lines **86.72 %** (1568/1808), statements 80.62 % (1814/2250), functions 82.09 % (408/497), branches 66.15 % (1071/1619) |
| HTTP smoke flow | `tests/http/api-flow.mjs` against the production standalone server | CI job "Build + Playwright e2e" | **32/32 HTTP checks passed** |
| Browser end-to-end | Playwright 1.64, Chromium, production build + migrated and seeded DB | same job | **4 specs, 4 passed** (19.3 s), 0 flaky |

## Vitest files (counts from the CI log)

| File | Tests | Covers |
|---|---|---|
| `tests/unit/money.test.ts` | 9 | decimal → integer minor units (TND 3 decimals), basis-point fees with half-up rounding, release split sums to gross |
| `tests/unit/permissions.test.ts` | 6 | sign-in/capability/verified-email gates, proposal visibility, contract roles, self-dealing guard, contact-detail heuristic |
| `tests/unit/state-machines.test.ts` | 7 | job, proposal, offer, milestone and contract transitions; terminal states; milestones funded in order |
| `tests/unit/webhook-signature.test.ts` | 7 | HMAC verification, tampered body, wrong secret, replay window, malformed headers, no immediate success |
| `tests/unit/r2-domain.test.ts` | 14 | UTC week starts, minute rounding and billing, weekly limits, payment state rules, admin/agency roles, file type sniffing and name sanitizing, review reveal, LiveKit token signing, S3 SigV4 |
| `tests/integration/auth.test.ts` | 4 | register → verify → login → logout, duplicate emails, single-use reset, one identity with two capabilities |
| `tests/integration/isolation.test.ts` | 7 | private proposals/jobs/offers/contracts/payments are participant-only; conversations cannot be joined by guessing; unverified accounts are gated |
| `tests/integration/marketplace-flow.test.ts` | 1 | full fixed-price path through the service layer, ledger balanced |
| `tests/integration/webhooks-and-concurrency.test.ts` | 11 | replay idempotency, out-of-order events, bad signatures, amount mismatch, failed payments, unconfigured provider, concurrent offer acceptance, expiry, self-application |
| `tests/integration/r2-proposals-messaging.test.ts` | 7 | screening answers, invitations, notifications and preferences, block/report and message edits, file storage + signed URLs, interviews with ICS and LiveKit gating |
| `tests/integration/r2-hourly.test.ts` | 3 | timer, manual time, weekly limit, timesheet submit/approve/dispute/pay |
| `tests/integration/r2-services-reviews.test.ts` | 3 | service moderation → order → webhook payment → delivery → completed; max concurrent orders; review eligibility |
| `tests/integration/r2-agency-admin-disputes.test.ts` | 4 | agency invites and roles, staff permissions and audit, private support tickets, disputes with webhook-confirmed refunds |
| `tests/integration/r3-console-queries.test.ts` | 2 | admin console and profile read models |

## Playwright specs

| Spec | Flow | Result |
|---|---|---|
| `e2e/main-path.spec.ts` | post job → apply → message → offer → accept → fund (test checkout + webhook) → deliver → approve → release | pass (7.6 s) |
| `e2e/r2-flows.spec.ts` › services | browse catalog → tier checkout → provider webhook → requirements → deliver → approve → completed + reviews | pass (3.5 s) |
| `e2e/r2-flows.spec.ts` › hourly | hourly job → proposal → hourly offer → accept → web timer → manual entry → submit timesheet → client approves → test checkout → paid | pass (5.8 s) |
| `e2e/r2-flows.spec.ts` › admin | non-staff get 404 on `/admin` → freelancer submits a service → moderator approves → listing is public; moderator cannot read the audit log | pass (1.8 s) |

### Bug found by the e2e suite

The hourly spec failed in CI run [39722924041](https://github.com/bileldh-ing/workspring/actions/runs/39722924041) (commit `32a5337`): the offer page crashed on hourly offers (`Cannot read properties of undefined (reading 'map')`) because it assumed every terms snapshot has milestones. Commit `fda9fb0` makes the offer page render hourly terms (rate, weekly limit, weekly maximum, manual-time flag). The same commit fixed two mistakes in the spec itself: it now opens the collapsed "Add manual time" panel, and it goes through the test provider's hosted checkout after approving a timesheet.

## Screenshots

`docs/screenshots/01-…06-*.png` are written by the Playwright specs during the reference run and downloaded from its `screenshots` artifact. They show seeded **synthetic** data in TEST MODE.

## Running locally

```bash
pnpm lint && pnpm typecheck
pnpm test                 # starts embedded Postgres when TEST_DATABASE_URL is unset
pnpm test:coverage
pnpm build && pnpm db:migrate && pnpm db:seed && pnpm start
node tests/http/api-flow.mjs
pnpm exec playwright install chromium && pnpm e2e
```

## What is not tested

- No automated accessibility audit (axe or similar). Labels, focus and roles are checked by hand, and indirectly by Playwright's role/label locators.
- No load, performance or soak tests.
- Only Chromium runs in e2e. Firefox, WebKit and mobile viewports have not been run.
- The Android APK is built in CI but has no automated device or emulator tests.
- Live payment providers, SMTP delivery and LiveKit video are not configured, so their real integrations are not exercised. Only the refusal paths ("not configured") are tested.
- Branch coverage is 66 %; error branches in the server layer are the main gap.

## CI status by commit

| Commit | CI | Security | Notes |
|---|---|---|---|
| `32a5337` | ❌ [39722924041](https://github.com/bileldh-ing/workspring/actions/runs/39722924041) | ✅ | hourly e2e failed (offer page crash) |
| `fda9fb0` | ✅ [39724354883](https://github.com/bileldh-ing/workspring/actions/runs/39724354883) | ✅ [39724354896](https://github.com/bileldh-ing/workspring/actions/runs/39724354896) | reference run for this page |
| `1b0e880` | cancelled (superseded by the next push) | ✅ | screenshots + hourly start notice; standalone arm64 build ✅ [39724928380](https://github.com/bileldh-ing/workspring/actions/runs/39724928380) |
| `d676cd1` | ✅ [39725184850](https://github.com/bileldh-ing/workspring/actions/runs/39725184850) (85 tests, 32/32 HTTP, 4/4 e2e) | ✅ [39725184953](https://github.com/bileldh-ing/workspring/actions/runs/39725184953) | docs; Mobile ✅ [39725191487](https://github.com/bileldh-ing/workspring/actions/runs/39725191487) → `workspring-debug-apk` |
