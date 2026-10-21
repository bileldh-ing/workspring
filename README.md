# WorkSpring

WorkSpring (provisional name; trademark and domain checks are still needed before any commercial use) is an original freelance marketplace. It is **pre-release software**. This first release (R1) delivers one genuine, tested path:

**account → freelancer profile → job post → search → proposal → private messages → offer → acceptance → contract workroom → fixed-price milestones (fund → deliver → revise → approve → release) → double-entry ledger**

Everything runs on a real PostgreSQL database with committed migrations. State changes happen on the server, with authorization checks and event history. Payments run in **TEST MODE**: a simulated provider sends HMAC-signed webhooks. No real money moves, and WorkSpring does **not** offer escrow or payment protection.

WorkSpring is **not** an Upwork clone and does not claim to match it. `docs/REFERENCE_PRODUCT_AUDIT.md` lists, with sources, which publicly documented workflows were adapted and which were left out.

## What's different / honest by design

- One login can both hire and work. Adding the second capability never creates a duplicate account.
- No ratings, "verified" or "top talent" badges, and no fake counters. Profiles show only contracts actually completed on WorkSpring.
- A milestone is "funded" or "released" **only** after a verified provider webhook. Clicking a button or landing on a redirect page is never enough.
- Fees come from a versioned fee rule. The rule in force is snapshotted onto every offer and contract, and amounts are integer minor units.
- Seed data is synthetic: users have a `[Demo]` prefix and an `is_demo` flag, and the UI shows a "Synthetic demo" badge on their records.

## Quick start

```bash
pnpm install
cp .env.example .env.local          # set TEST_PROVIDER_WEBHOOK_SECRET (≥32 chars)
pnpm db:start                       # terminal 1: real PostgreSQL 17 via embedded-postgres
pnpm db:migrate && pnpm db:seed     # terminal 2
pnpm dev                            # http://localhost:3000
```

Demo logins (synthetic; password `demo-password-2026`): `client-olive@demo.workspring.test` (client) and `amira@demo.workspring.test` (freelancer). Verification and reset emails appear at `/dev/outbox`.

Full instructions: [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md).

## Screenshots

`docs/screenshots/` (see [`docs/TESTING.md`](docs/TESTING.md) for how they were produced, or why they're missing).

## Docs

| Doc | |
|---|---|
| [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md) | What works, with evidence; what's planned |
| [REFERENCE_PRODUCT_AUDIT](docs/REFERENCE_PRODUCT_AUDIT.md) | Dated public-source audit: confirmed / inferred / not included |
| [ARCHITECTURE](docs/ARCHITECTURE.md) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md) | System design |
| [CONTRACT_LIFECYCLE](docs/CONTRACT_LIFECYCLE.md) · [PAYMENTS_AND_LEDGER](docs/PAYMENTS_AND_LEDGER.md) | State machines, money |
| [TESTING](docs/TESTING.md) · [TECH_DECISIONS](docs/TECH_DECISIONS.md) · [LOCAL_SETUP](docs/LOCAL_SETUP.md) | Ops |

## Demo restrictions

- TEST MODE payments only. Live providers are unconfigured on purpose (Stripe is not available to a Tunisia-based platform; see the payments doc).
- No SMTP: emails stay in the `email_outbox` table.
- Not built yet: hourly contracts and time tracking, services catalog, agencies and teams, interviews and video, reviews, disputes and support, admin console, attachments and file storage, notifications center.
