# Product requirements

WorkSpring is an original two-sided freelance marketplace: clients hire independent professionals for fixed-price or hourly work or buy pre-packaged services; freelancers find work, sell services and get paid through a payment provider. This document defines roles, journeys, features, state transitions and acceptance tests for the current build. Status per feature lives in `IMPLEMENTATION_STATUS.md`.

## Roles

| Role | How obtained | Can |
|---|---|---|
| Visitor | — | browse landing, jobs, talent, services, agencies, fees, trust pages |
| Client | capability on the account (sign-up intent "hire", or add later) | post jobs, invite, review proposals, interview, offer, fund, approve, order services, review |
| Freelancer | capability ("work") | profile, apply, interview, accept offers, deliver, track time, sell services, join/create agencies, review |
| Agency owner / admin / member | agency membership | owner: everything incl. roles; admin: invite/remove/edit profile; member: view team |
| Staff: superadmin, support, moderator, finance | `admin_roles` rows (granted by a superadmin, audited) | see `SECURITY_PRIVACY.md` matrix |

One identity can hold both client and freelancer capabilities and switch mode in the header.

## Journeys and acceptance tests

Each journey lists its acceptance test(s). "IT" = Vitest integration test against real Postgres, "E2E" = Playwright through the browser, "HTTP" = `tests/http/api-flow.mjs`.

1. **Account**: register (Argon2id), verify email (outbox), sign in/out, reset password, add second capability, switch mode. *IT `auth.test.ts`, HTTP.*
2. **Freelancer profile**: create/edit, skills from taxonomy, publish/hide; public SSR page without email; reviews, services, invite box, report/block. *IT flow tests; E2E main path visits search.*
3. **Job posting**: draft → open → paused → open → closed; screening questions (≤ 5); contact-detail heuristic; invitations to apply (14-day expiry). *IT, E2E main path + hourly test.*
4. **Search**: jobs, talent, services with Postgres FTS, filters, sort, pagination, URL state; empty states. *IT, E2E.*
5. **Proposals**: bid/rate, duration, cover letter, screening answers, attachments, withdraw, shortlist, decline with reason; terms snapshot. *IT `r2-proposals-messaging.test.ts`, E2E.*
6. **Messaging**: private conversations (membership-checked), attachments, edit/delete windows, block/report, unread counts. *IT, E2E.*
7. **Interviews**: propose time (UTC stored, local display), accept/decline/cancel, `.ics` download; video join only when LiveKit is configured (otherwise an explicit "not configured" state). *IT.*
8. **Offers → contract**: fixed (1–10 milestones) or hourly (rate, weekly limit, manual-time flag); 14-day expiry; accept creates exactly one contract (locks + partial unique index). *IT concurrency tests, E2E.*
9. **Fixed-price milestones**: fund (provider checkout) → funded **only on verified webhook** → deliver (versioned, files) → revision → approve → release (provider transfer webhook) → contract completes when all released; dispute puts a milestone on hold. *IT, E2E main path.*
10. **Hourly**: web timer, manual entries (if allowed), weekly limit, weekly timesheet submit → client approve (provider payment webhook) or dispute → correct → resubmit; end contract. *IT `r2-hourly.test.ts`, E2E hourly test.*
11. **Services catalog**: draft listing with 3 tiers (non-decreasing price), add-ons, requirements, max concurrent orders → submit → moderation (approve / request changes with note) → published; edits send it back to review; buyer checkout snapshot → paid on webhook → requirements → delivery → revisions (tier limit) → approve → release on webhook. *IT `r2-services-reviews.test.ts`, E2E services + admin tests.*
12. **Reviews**: only parties of completed contracts/orders, once each, 1–5 stars + text; double-blind reveal (both submitted or 14 days); moderation can hide with a note. *IT.*
13. **Agencies**: create (one owned agency), publish profile, invite existing freelancers by email, accept/decline/revoke, change roles, remove/leave (soft, history kept). *IT `r2-agency-admin-disputes.test.ts`.*
14. **Notifications**: in-app centre with unread badge, per-category email/in-app preferences (payments & safety in-app mandatory). *IT.*
15. **Support & disputes**: tickets with attachments, staff replies, statuses; milestone disputes → staff resolve (release or provider refund, refunded only on webhook). *IT.*
16. **Admin console**: overview counts, users (search, suspend/reinstate with reason, grant roles), service moderation, reviews, abuse reports, support queue, payments & webhook log, disputes, audit log. All actions audited; non-staff get 404. *IT, E2E admin test.*
17. **PWA / mobile**: manifest, icons, service worker with offline page; Capacitor Android debug APK built in CI. *CI `mobile.yml`.*

## State machines

Defined in `src/domain/state-machines.ts` (unit-tested) and described in `CONTRACT_LIFECYCLE.md`: job, proposal, offer, contract, milestone, timesheet, service listing, service order, dispute, support ticket, invitation.

## Non-goals in this build

Live payments/payouts/KYC, identity verification badges, AI features, company teams for clients, saved searches/lists, consultations, invoices/tax documents, native push notifications.
