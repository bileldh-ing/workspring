# Local setup

## Requirements

- Node.js ≥ 22 (tested 22.23.3), pnpm (tested 12.14.0; pnpm ≥ 9 should work), Linux or macOS on x64/arm64.
- **No Docker or system PostgreSQL needed**: `embedded-postgres` downloads the real PostgreSQL 17.10 binaries as an npm package.
- ~2 GB free RAM for `next build` (see Troubleshooting).

## First run

```bash
pnpm install                 # pnpm-workspace.yaml approves the native postinstall scripts it needs
cp .env.example .env.local   # then edit secrets (TEST_PROVIDER_WEBHOOK_SECRET ≥ 32 chars)
pnpm db:start                # terminal 1: real Postgres on WS_PG_PORT (default 54329), data in WS_PG_DATA (default .data/pg)
pnpm db:migrate              # terminal 2
pnpm db:seed                 # synthetic demo data (optional)
pnpm dev                     # http://localhost:3000
```

Demo accounts (all **synthetic**, password `demo-password-2026`, email already verified):
- Clients: `client-olive@demo.workspring.test`, `client-atlas@demo.workspring.test`
- Freelancers: `amira@`, `youssef@`, `lea@`, `sami@`, `nour@` + `demo.workspring.test`

Emails (verification, password reset) are not sent anywhere: open **http://localhost:3000/dev/outbox** and click the link.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `WS_PG_DATA` | no | `.data/pg` | data dir for `pnpm db:start` |
| `WS_PG_PORT` | no | `54329` | port for `pnpm db:start` |
| `APP_URL` | yes (emails) | `http://localhost:3000` | absolute links in emails |
| `PAYMENTS_PROVIDER` | no | `test` | `test` = simulated TEST MODE provider; anything else = unconfigured (no live provider exists) |
| `TEST_PROVIDER_WEBHOOK_SECRET` | for test provider | — | HMAC secret (≥ 32 chars); server-only |
| `ENABLE_DEV_OUTBOX` | no | `false` | expose `/dev/outbox` when `NODE_ENV=production` |
| `WS_SKIP_BUILD_TYPECHECK` | no | unset | `1` skips Next's in-build type-check (use only where `pnpm typecheck` runs separately) |

No secret is exposed to the browser (no `NEXT_PUBLIC_*` variables are used).

## Useful commands

```bash
pnpm typecheck && pnpm lint && pnpm test   # see TESTING.md
pnpm build && pnpm start
pnpm db:reset                              # DEV ONLY: wipe + re-migrate
```

## Troubleshooting

- **`PostgreSQL failed to start on port …`**: another Postgres uses the port. Set `WS_PG_PORT` (and `DATABASE_URL`) to a free port. (In the authoring sandbox another project already used 54329, so `.env.local` there uses 54341.)
- **Slow Postgres on network/FUSE filesystems**: put `WS_PG_DATA` on a local disk (the authoring sandbox used `/tmp/workspring-pg`; initdb on the FUSE workspace took ~48 s vs ~1.5 s on local disk).
- **`next build` killed (exit 137 / SIGKILL)**: out of memory. Try `pnpm exec next build --webpack` with `NODE_OPTIONS=--max-old-space-size=1536` and, if needed, `WS_SKIP_BUILD_TYPECHECK=1` after running `pnpm typecheck` yourself. `next.config.ts` already limits build workers to 1 CPU.
