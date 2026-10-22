# Deployment

Status: **not deployed**. Everything below is wired and tested in CI up to the deploy gate; the Fly.io job skips (green, with a notice) until `FLY_API_TOKEN` is configured. Payments stay in TEST MODE until a live provider is contracted and reviewed (see `PAYMENTS_AND_LEDGER.md`).

## Production services

| Concern | Choice (default) | Alternatives |
|---|---|---|
| App runtime | Docker image (`Dockerfile`, target `runner`, Next.js standalone `server.js`, non-root, healthcheck on `/api/health`) | any container host (Render, Railway, ECS, Kubernetes) |
| Hosting | Fly.io (`fly.toml`, region `cdg`, rolling deploys, HTTP checks) | — |
| Database | Managed PostgreSQL 17 (Fly Postgres / Neon / Supabase Postgres / RDS) with daily backups + PITR | — |
| File storage | `STORAGE_DRIVER=s3` with a **private** bucket (Cloudflare R2 / S3); `local` + a Fly volume only for single-machine demos | — |
| Email | Not wired (rows stay in `email_outbox`). Add an SMTP/API sender worker before launch | Postmark, SES, Resend |
| Video | LiveKit Cloud (optional; `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) | self-hosted LiveKit |
| Images | GHCR (`release.yml` on `v*` tags) | — |

## Environment / secrets

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | TLS connection string |
| `APP_URL` | yes | public https origin; enables HSTS/upgrade-insecure-requests |
| `FILE_URL_SECRET` | yes (prod) | ≥ 32 chars; signs private download URLs; rotate to invalidate links |
| `PAYMENTS_PROVIDER` | yes | `test` for staging/demo; any other value = explicit "not configured" |
| `TEST_PROVIDER_WEBHOOK_SECRET` | with `test` | ≥ 32 chars |
| `STORAGE_DRIVER`, `STORAGE_DIR` or `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` | yes | private bucket only |
| `RATE_LIMIT_DRIVER` | no | `db` (default, shared across instances) or `memory` |
| `LIVEKIT_*` | no | all three or none |
| `LOG_LEVEL` | no | `info` |

Store secrets in the host's secret manager (`fly secrets set …`), GitHub Environments (`production`) for CI, never in the repo. `src/lib/env.ts` validates them at boot and the process refuses to start on a bad production config.

## Fly.io first deploy

```bash
fly apps create workspring
fly volumes create workspring_storage --size 1 --region cdg      # only for STORAGE_DRIVER=local
fly secrets set DATABASE_URL=… APP_URL=https://workspring.fly.dev FILE_URL_SECRET=… TEST_PROVIDER_WEBHOOK_SECRET=…
# migrations (the runner image has no dev deps): run the migrate stage once per release
fly machine run --dockerfile Dockerfile --build-target migrate --rm -e DATABASE_URL=…   # or: DATABASE_URL=… pnpm db:migrate from CI
fly deploy --remote-only
```

Then add the repository secret `FLY_API_TOKEN` (`fly tokens create deploy`) and the variable `PRODUCTION_URL`; `deploy.yml` deploys after every green CI run on `main` and smoke-checks `/api/ready`.

**Never run `pnpm db:seed` in production** — the script refuses unless `ALLOW_DEMO_SEED=true` is set explicitly for a demo environment.

## Webhooks

Provider webhooks are received at `POST /api/provider-webhooks/<provider>`. Only the test provider exists; it is called in-process by the simulated checkout. A live provider must register this URL in its dashboard and set its signing secret as an env var.

## Monitoring

- Liveness `GET /api/health` (process up), readiness `GET /api/ready` (database reachable).
- Structured JSON logs with PII scrubbing (`src/lib/logger.ts`) → ship stdout to the host's log drain.
- Alert on: readiness failures, 5xx rate, webhook `outcome != applied` spikes (visible in `/admin/payments`), failed payment intents.

## Backups & restore

- Managed Postgres daily snapshots + point-in-time recovery (≥ 7 days). Test a restore quarterly: `pg_restore` into a scratch database, run `pnpm db:migrate` (no-op if current), boot the app against it and run the HTTP smoke flow (`node tests/http/api-flow.mjs`).
- Object storage: enable bucket versioning; files are addressed by `<entity>/<id>/<uuid>` so a DB restore and a bucket restore can be matched.
- The ledger is append-only; never "fix" rows in place — post reversing entries.
