# WorkSpring demo script (for a screen-recording agent)

Base URL: `http://localhost:3107` (local `next start`). All data is **synthetic** (names start with `[Demo]`, emails end in `@demo.workspring.test`). Every account's password is **`demo-password-2026`**. Payments are **TEST MODE**: the "provider checkout" is simulated and no money moves; say so on camera.

Selector conventions: `role=button[name="…"]` = Playwright `getByRole("button", { name: "…" })`; `label="…"` = `getByLabel("…")`; `testid=…` = `getByTestId("…")`. Unless noted, names are exact.

**Sign-in macro (S)**: go to `/signin` → fill `label="Email"` → fill `label="Password"` with `demo-password-2026` → click `role=button[name="Sign in"]` → lands on `/app`. To switch user, click `role=button[name="Sign out"]` in the header first (or clear cookies).

| Account | Role | Seeded state |
|---|---|---|
| `client-olive@demo.workspring.test` | client | open jobs; paid service order (in progress) with Amira; completed contract with Nour (reviews revealed); a support ticket |
| `client-atlas@demo.workspring.test` | client | open jobs; active **hourly** contract with Youssef (2 manual entries); filed an abuse report |
| `amira@demo.workspring.test` | freelancer | published profile; published service "Responsive landing page in Next.js with tests"; owner of agency "Spring Build Collective" |
| `youssef@demo.workspring.test` | freelancer | hourly contract; agency member |
| `lea@`, `sami@`, `nour@demo.workspring.test` | freelancers | Léa: published logo service; Sami: service **pending moderation**; Nour: completed contract + 5★ review |
| `admin@demo.workspring.test` | staff superadmin | all console pages |
| `support@demo.workspring.test` | staff support | users (read), support queue |
| `moderator@demo.workspring.test` | staff moderator | users, moderation, reviews, reports |
| `finance@demo.workspring.test` | staff finance | payments & webhooks, disputes, audit log |

---

## Chapter 1: Intro / landing
1. `/` → show `heading level=1` "Scope it, agree it, ship it, milestone by milestone." and the yellow **TEST MODE** banner at the top.
2. Header links: `link "Browse talent"` (`/talent`), `link "Find work"` (`/jobs`), `link "Services"` (`/services`), `link "How it works"`, `link "Fees"`. Footer: `link "Trust & payments"` (`/trust`).
3. `/fees` and `/trust`: point out the honest copy (no escrow claim, fee rule).

## Chapter 2: Auth
1. `/join` → `label="Your name"`, `label="Email"` (use a fresh address like `demo-viewer+<timestamp>@example.test`), `label="Password"` (12+ chars), choose the hire/work option, `role=button[name="Create account"]`.
2. Yellow banner "Verify your email…" → open `/dev/outbox` → click the newest verification link.
3. `role=button[name="Sign out"]`, then `/signin` → `link "Forgot password?"`-style link (`/forgot-password`) to show the reset flow (email appears in `/dev/outbox`).
4. Show mode switching: sign in as an account with both capabilities and click the header button `… mode · switch` (Settings → `role=button[name="Add freelancer capability"]` adds the second capability).

## Chapter 3: Freelancer profile
1. (S) `amira@…` → `/app/profile`: fields `label="Professional headline"`, `label="Overview"`, `label="Hourly rate"`, skills checkboxes; buttons `Save changes`, `Hide profile`/`Publish profile` (don't hide during the demo).
2. Public page: `/talent` → click "[Demo] Amira B." → `/freelancers/<slug>`: skills, rate, completed-contract count, **Services** card, **Reviews** card ("No reviews yet" for Amira is honest).
3. Show a profile **with reviews**: `/talent?q=writer` → "[Demo] Nour H." → Reviews card shows 5★ and the "[Synthetic demo review]" text (`testid=public-review`).

## Chapter 4: Job posting
1. (S) `client-olive@…` → nav `link "Post a job"` (`/app/jobs/new`).
2. Fill `label="Job title"`, `label="Category"` (select "Web & Mobile Development"), `label="Contract type"` (Fixed price), `label="Description, deliverables and success criteria"`, tick skills `label="React"` and `label="PostgreSQL"`, `label="Budget maximum (or hourly max)"` = 900, add a screening question if the field is shown.
3. `role=button[name="Save draft"]` → job page → `role=button[name="Publish"]` → notice "Job is now open." Show Pause/Reopen/Close buttons exist (don't close).

## Chapter 5: Search
1. `/jobs` → keyword `label="Keywords"` = "dashboard", `label="Category"`, `label="Contract type"`, `label="Sort by"` → `role=button[name="Apply filters"]`; show pagination and the empty state with a nonsense query.
2. `/talent` → filters → results.
3. `/services` → filters (`label="Keywords"`, `label="Category"`, `label="Starting price up to (major units)"`, `label="Sort by"`).

## Chapter 6: Proposals + screening questions
1. (S) `amira@…` → `/jobs?q=<your job title>` → click the job → `link "Submit a proposal"`.
2. Fill `label=/Your fixed bid/` = 850, `label="Estimated duration"`, `label="Cover letter"`, answer screening questions, attach a file via `label="Attachments (optional): portfolio samples, CV"`. `role=button[name="Send proposal"]` → "Proposal sent."
3. `/app/proposals` lists it; the proposal page has `role=button[name="Withdraw proposal"]` (don't click).
4. Client side: (S) `client-olive@…` → job page → proposal → `role=button[name="Shortlist"]`; show answers and the attachment link (signed, private).
5. Invitations: open a freelancer profile as the client → `testid=invite-box` → `label="Job"`, `label="Message"` → `role=button[name="Send invitation"]`; the freelancer sees it in `/app/invitations`.

## Chapter 7: Messaging + attachments
1. On the proposal (client) → `role=button[name="Message freelancer"]` → `/app/messages/<id>`.
2. `role=textbox[name="Message"]` → type → optionally `label="Attach files (optional)"` → `role=button[name="Send message"]`.
3. Show edit: on your own recent message use `label="Edit message"` + `role=button[name="Save edit"]`, and `role=button[name="Delete message"]`.
4. Show the **Report** disclosure and the **Block member** button (don't confirm blocking).

## Chapter 8: Interviews
1. Client proposal page → `label="Date and time (your local time)"`, `label="Duration (minutes)"`, `label="Agenda (optional)"` → `role=button[name="Propose interview"]` → `/app/interviews?scheduled=1`.
2. (S) `amira@…` → `/app/interviews` → `Confirm`; show the `.ics` download link. `Join video room` shows "video not configured" unless LiveKit env vars are set (honest gated state).

## Chapter 9: Offers → contract
1. Client proposal page → `label="Contract title"`, `label="Scope and deliverables"`, milestone rows → `role=button[name="Send offer"]` → `/app/offers/<id>`.
2. (S) `amira@…` → open the offer → `role=button[name="Accept offer and start contract"]` (accept the confirm dialog) → `/app/contracts/<id>`.

## Chapter 10: Fixed-price milestones + test payments
1. (S) client → contract → `role=button[name=/^Fund .*\(test\)$/]` → `/test-provider/checkout/<id>` (point at the "not a real payment page" notice) → `role=button[name="Simulate: payment succeeded"]` → back with `?webhook=applied`, milestone badge **funded**.
2. (S) freelancer → `label="Delivery note"` + optional files → `role=button[name="Submit work"]` → badge **submitted**.
3. (S) client → (optional `Request revision`) → `role=button[name="Approve and release payment"]` (confirm) → `role=button[name="Simulate provider: transfer succeeded"]` → **released**, contract **completed**; show the ledger/event history and the **Reviews** form.
4. Disputes: on a funded milestone, `role=button[name="Open dispute"]` with `label="What went wrong?"` (show only; it puts the milestone on hold).

## Chapter 11: Hourly timer / timesheets
1. (S) `youssef@…` → `/app/contracts` → "Flutter maintenance (synthetic demo, hourly)".
2. `role=button[name="Start timer"]` → elapsed time shows → `role=button[name="Stop timer"]`.
3. Manual entry: `label="Date (UTC)"` (today), `label="Minutes"` = 30, `label="Memo"` → `role=button[name="Add entry"]`. Show the weekly-limit progress bar (`label="Weekly limit used"`).
4. `role=button[name="Submit timesheet"]`.
5. (S) `client-atlas@…` → same contract → `role=button[name=/^Approve and pay /]` → `role=button[name="Simulate provider: payment succeeded"]` → timesheet **paid**. Mention `Dispute this week` exists.

## Chapter 12: Services catalog + orders
1. Visitor `/services` → `link "Responsive landing page in Next.js with tests"` → package table, requirements, order box (`testid=order-box`) asking to sign in.
2. (S) `client-atlas@…` → same page → `testid=tier-standard` → optional add-on checkbox → `role=button[name="Continue to payment"]` → `role=button[name="Simulate: payment succeeded"]` → `/app/orders/<id>?webhook=applied`.
3. Answer `label=/brand assets/` and `label=/target audience/` → `role=button[name="Submit requirements and start order"]`.
4. (S) `amira@…` → `/app/orders` (Selling) → order → `label="Delivery note"` → `role=button[name="Send delivery"]`.
5. (S) `client-atlas@…` → order → `role=button[name="Request revision"]` (with `label="What should change?"`) or `role=button[name="Approve and release payment"]` → `role=button[name="Simulate provider: transfer succeeded"]` → **completed** → review form.
6. Seller editor: (S) `amira@…` → `/app/services` → `role=button`/link `New service` → fill `label="Title"`, `label="Category"`, `label="Summary"`, `label="Description"`, the three package columns, add-ons, requirements → `Save draft` → `Submit for review` (continue in Chapter 17).

## Chapter 13: Reviews
1. Completed contract (olive ↔ nour): (S) `client-olive@…` → `/app/contracts` → "API documentation review (synthetic demo)" → Reviews section shows both reviews (revealed).
2. Explain double-blind: on a fresh completion, submit `label="Rating"` + `label="Your review"` → `Submit review` → "Hidden until the other party reviews…".
3. Public: `/freelancers/<nour slug>` → Reviews card.

## Chapter 14: Agencies
1. (S) `amira@…` → nav `Agency` (`/app/agency`) → agency profile form, **Members** list (`testid=agency-member`) with `Make admin` / `Remove` buttons, **Invite a freelancer** (`label="Freelancer's WorkSpring email"`, `label="Role"`).
2. Public page: link "public page" → `/agencies/<slug>`.
3. (S) `youssef@…` → `/app/agency` shows the team as a member (no management buttons except `Leave agency`).

## Chapter 15: Notifications
1. Any account with activity (e.g. `amira@…` after Chapter 12) → header bell (`testid=header-notifications`) shows the unread count; workspace nav "Notifications" has a red badge (`testid=nav-unread`).
2. `/app/notifications` → `role=button[name="Mark read"]` / `role=button[name="Mark all as read"]`.
3. `/app/settings` → per-category email/in-app checkboxes → `role=button[name="Save preferences"]`; blocked members list.

## Chapter 16: Support / disputes
1. (S) `client-olive@…` → nav `Support` (`/app/support`) → seeded ticket "How do refunds work in test mode?"; open a new one with `label="Subject"`, `label="Category"`, `label="How can we help?"` → `Send to support`.
2. (S) `support@…` → `/admin/support` → open the ticket → `label="Reply"` → `role=button[name="Reply as support"]` → `Mark resolved`.
3. Disputes: (S) `finance@…` → `/admin/disputes` (resolve with `Resolve: allow release` or `Resolve: refund client`; a refund completes only after the provider webhook, which in test mode is triggered from `/admin/payments` → `Simulate refund succeeded`).

## Chapter 17: Admin console
1. (S) `client-olive@…` → `/admin` → **404** (console isn't discoverable for non-staff).
2. (S) `admin@…` → nav `Admin console` → `/admin` overview tiles (`testid=tile-*`).
3. `/admin/users` → search "demo" → user cards (`testid=admin-user`) with `Suspend` (+ reason) and *Staff roles* disclosure (show, don't suspend).
4. (S) `moderator@…` → `/admin/moderation` → item (`testid=moderation-item`) "Image classification baseline with an evaluation report" → `role=button[name="Approve and publish"]` → "Moderation decision recorded." → it now appears on `/services`.
5. `/admin/reviews` (hide/unhide), `/admin/reports` (seeded report → `Update report` with status + note).
6. `/admin/audit` as moderator → "Not available for your staff role". (S) `finance@…` → `/admin/audit` shows the moderation entry; `/admin/payments` shows intents and webhook events (verified/applied).

## Chapter 18: PWA / mobile
1. Chrome DevTools → Application → Manifest (`/manifest.webmanifest`, icons, theme colour) and Service Workers (`/sw.js` registered in production).
2. DevTools → Network → Offline → reload a page → `/offline` fallback "You're offline".
3. Mobile viewport (Pixel 7 emulation) on `/jobs` and a contract workroom.
4. GitHub → Actions → **Mobile (Capacitor)** run → artifact `workspring-debug-apk`.

## Chapter 19: CI/CD on GitHub
1. https://github.com/bileldh-ing/workspring/actions → latest **CI** run: jobs *Lint & typecheck*, *Unit + integration tests (Postgres 17)*, *Build + Playwright e2e (Chromium)* all green; open the e2e job log (4 tests passed) and the `playwright-report` artifact.
2. **Security** (CodeQL, audit), **Deploy** (skipped notice: FLY_API_TOKEN not set), **Release** (on tags), **Mobile (Capacitor)**.
3. Repo `docs/` folder: IMPLEMENTATION_STATUS, TESTING, SECURITY_PRIVACY, DEPLOYMENT, CI_CD.
