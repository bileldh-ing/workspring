# Technical decisions (R1, 2026-10-21)

Exact versions are pinned in `package.json` and locked in `pnpm-lock.yaml`. Versions were the latest stable on the npm registry on 2026-10-21 unless noted.

| Area | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node.js | 22.23.3 (env) | LTS line available in the build environment |
| Package manager | pnpm | 12.14.0 was what the environment actually had (the brief said pnpm 10). Lockfile is pnpm v9 format; `pnpm-workspace.yaml` uses `allowBuilds` to approve native postinstall scripts (esbuild, embedded-postgres binaries, unrs-resolver) | |
| Framework | Next.js App Router (Turbopack dev) | 16.4.2 | Latest stable; server components for SSR public pages, server actions for forms, route handlers for the JSON API |
| UI | React / React DOM | 19.3.1 | Required by Next 16 |
| Styling | Tailwind CSS (v4, `@theme` tokens) + `@tailwindcss/postcss` | 4.3.3 | Token-based original design system in `src/app/globals.css` |
| Language | TypeScript | 5.9.3 | TS 7.0.2 (native port) is the npm `latest` tag, but the Next.js type plugin and typescript-eslint are verified against 5.x; chose the stable 5.9 line |
| ORM / migrations | Drizzle ORM + drizzle-kit | 0.45.4 / 0.31.11 | Typed SQL close to Postgres, generated SQL migrations committed in `drizzle/` |
| Postgres driver | postgres (postgres.js) | 3.4.9 | Fast, supports transactions/row locks well with Drizzle |
| Dev/test database | **embedded-postgres** (real PostgreSQL 17.10 binaries) | 17.10.0-beta.17 (the package versions are all tagged `-beta`; the bundled server is PostgreSQL 17.10 stable) | No Docker / system Postgres in the environment. Chosen over PGlite because it is the real server binary with real concurrency, row locking, advisory locks and multiple connections, which the concurrency tests need. PGlite is single-connection WASM and can't exercise concurrent offer acceptance faithfully |
| Validation | zod | 4.6.7 | Schemas shared by server actions and API routes |
| Password hashing | @node-rs/argon2 (Argon2id, m=19 MiB, t=2, p=1) | 2.2.2 | Prebuilt native binaries (no node-gyp), OWASP-recommended parameters |
| Tests | Vitest | 5.0.5 | Unit + integration (against the embedded Postgres) |
| Lint | ESLint 9 flat config + eslint-config-next | 9.39.5 / 16.4.2 | `next lint` was removed in Next 16; ESLint 10 skipped for plugin compatibility |
| E2E | Playwright | not installed | See `TESTING.md`: browser download was not attempted in this shared, memory-constrained sandbox; documented as a blocker |

## Payments

- **Stripe Connect is not used.** On 2026-10-21 `https://stripe.com/global` lists supported countries and Tunisia is not among them, so a Tunisia-based platform entity cannot open a Stripe account. (Spec §2/§16: verify eligibility, don't assume.)
- Implemented a **provider-neutral adapter** (`src/server/payments/types.ts`) with:
  - `test` provider: clearly labelled TEST MODE, HMAC-SHA256 signed webhooks (`x-workspring-test-signature: t=…,v1=…`, 5-minute tolerance, constant-time compare), never reports synchronous success.
  - `unconfigured` state for any other `PAYMENTS_PROVIDER` value: every money operation raises `PROVIDER_UNCONFIGURED`; the UI disables funding/release and explains why. No fake success.
- No escrow / safeguarded funds claims anywhere. See `PAYMENTS_AND_LEDGER.md`.

## Other decisions

- **Sessions**: opaque 32-byte random token in an `httpOnly`, `SameSite=Lax`, `Secure` (production) cookie; only `sha256(token)` stored in `sessions`. 30-day absolute expiry. Password reset deletes all sessions.
- **CSRF**: server actions rely on Next.js' built-in Origin check; JSON route handlers require a same-origin `Origin` header for mutations; the webhook route is exempt (signature-authenticated).
- **Authorization** lives in the service layer (`src/server/services/*`), never in UI. Resources a caller can't see return `NOT_FOUND` (no ID enumeration).
- **Search**: Postgres full-text search (generated `tsvector` columns + GIN indexes, `websearch_to_tsquery`). No external search engine.
- **Email**: `email_outbox` table with a unique `dedupe_key` (idempotent enqueue). No SMTP transport configured; dev viewer at `/dev/outbox`.
- **Supabase/RLS**: not used. Authorization is enforced in the service layer and covered by integration tests. RLS could be added as defence in depth later.
- **Object storage**: not used in R1 (no attachments yet).
