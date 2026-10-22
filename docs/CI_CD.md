# CI/CD (GitHub Actions)

Repository: https://github.com/bileldh-ing/workspring · Actions: https://github.com/bileldh-ing/workspring/actions

| Workflow | File | Trigger | What it does |
|---|---|---|---|
| **CI** | `.github/workflows/ci.yml` | push to `main`, PRs, manual | 3 jobs: **Lint & typecheck** (`pnpm lint`, `pnpm typecheck`); **Unit + integration tests** on a `postgres:17` service with coverage (`pnpm test:coverage`, coverage artifact); **Build + Playwright e2e** (`pnpm build`, migrate + seed synthetic data, start the standalone server, HTTP smoke flow `tests/http/api-flow.mjs`, Playwright Chromium `pnpm e2e`, report/screenshots artifacts) |
| **Security** | `security.yml` | push, PRs, weekly (Mon 03:17 UTC) | CodeQL (JS/TS), `pnpm audit` on production deps (fails on high/critical), dependency review on PRs (non-blocking until the dependency graph is enabled) |
| **Release** | `release.yml` | tag `v*`, manual | Builds the Docker image and pushes `ghcr.io/bileldh-ing/workspring:<tag>` + `latest`, generates a changelog |
| **Deploy** | `deploy.yml` | after CI succeeds on `main`, manual | Gate job: skips green with a notice unless `FLY_API_TOKEN` is set; otherwise `flyctl deploy` + `/api/ready` smoke check (`production` environment) |
| **Mobile (Capacitor)** | `mobile.yml` | manual, pushes touching `mobile/**` | Generates the Android project, builds a debug APK artifact; signed AAB when signing secrets exist (`docs/MOBILE.md`) |
| Dependabot | `.github/dependabot.yml` | weekly | npm + GitHub Actions updates |

## Required secrets / variables

| Name | Kind | Used by | Set? |
|---|---|---|---|
| `FLY_API_TOKEN` | secret | deploy | not set (deploy skips) |
| `PRODUCTION_URL` | variable | deploy smoke check | not set |
| `CAP_SERVER_URL`, `CAP_APP_ID` | variables | mobile | not set (defaults used) |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | secrets | mobile signed AAB | not set |

CI itself needs no secrets: test-only values (`TEST_PROVIDER_WEBHOOK_SECRET`, `FILE_URL_SECRET`) are inline in `ci.yml` and are useless outside CI.

## Local equivalents

```bash
pnpm lint && pnpm typecheck
pnpm test                       # needs Postgres; tests/global-setup.ts starts embedded Postgres if TEST_DATABASE_URL is unset
pnpm build && pnpm start        # then: node tests/http/api-flow.mjs && pnpm e2e
```

Latest run results are recorded in `TESTING.md`.
