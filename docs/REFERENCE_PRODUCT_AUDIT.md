# Reference Product Audit (Upwork public help center)

**Verification date:** 2026-10-21 (all URLs fetched on this date by an automated, unauthenticated HTTP fetch of the public help-center pages).
**Method:** Only public, logged-out official help-center articles were read. No login, no private API, no scraping of user/job data. A plain `curl` of the same pages returned HTTP 403 (bot protection); a rendering fetcher returned HTTP 200 with readable article text, which is what this audit is based on. Screenshots were **not** collected.

**Legend**

- **Confirmed** = stated in the cited public article on 2026-10-21.
- **Inferred** = WorkSpring design inference; *not* an Upwork fact.
- **Decision**: `parity` (same workflow shape, original implementation/copy), `adapted` (deliberately different), `not included` (out of scope or needs credentials/legal/contract).
- **Phase / status** refer to WorkSpring's own plan (see `IMPLEMENTATION_STATUS.md`). "Built (R1)" means built and tested in this first run.

WorkSpring does **not** claim parity with Upwork. It reproduces a small set of common marketplace workflow *shapes* with its own design, copy, fees and rules.

## Sources

| # | Article | URL | Fetch result |
|---|---|---|---|
| S1 | How to post a job | https://support.upwork.com/hc/en-us/articles/211063408-Post-a-Job | 200, read |
| S2 | How to start hiring on Upwork | https://support.upwork.com/hc/en-us/articles/211063398-How-to-start-hiring-on-Upwork | 200, read |
| S3 | ✓ Send an offer | https://support.upwork.com/hc/en-us/articles/17943362171411--Send-an-offer | 200, read |
| S4 | How to submit a proposal on Upwork | https://support.upwork.com/hc/en-us/articles/211062998-How-to-submit-a-proposal-on-Upwork | 200, read |
| S5 | How to invite freelancers to your job | https://support.upwork.com/hc/en-us/articles/211063518-How-to-invite-freelancers-to-your-job | 200, read |
| S6 | ✓ Use messages | https://support.upwork.com/hc/en-us/articles/17943213453715--Use-messages | 200, read |
| S7 | What is Project Catalog on Upwork? | https://support.upwork.com/hc/en-us/articles/10408677826963-What-is-Project-Catalog-on-Upwork | 200, read |
| S8 | How to create a project in Project Catalog | https://support.upwork.com/hc/en-us/articles/360057397533-How-to-create-a-project-in-Project-Catalog | 200, read |
| S9 | ✓ Decide between hourly and fixed-price contract | https://support.upwork.com/hc/en-us/articles/17931377993107--Decide-between-hourly-and-fixed-price-contract | 200, read |
| S10 | How to create an agency | https://support.upwork.com/hc/en-us/articles/211067598-How-to-create-an-agency | 200, read |
| S11 | How to set up roles in your agency | https://support.upwork.com/hc/en-us/articles/360009646553-How-to-set-up-roles-in-your-agency | 200, read |
| P1 | Stripe global availability | https://stripe.com/global | 200, read: Tunisia is **not** in the supported-country list on 2026-10-21 |
| P2 | Stripe Connect marketplaces | https://stripe.com/connect/marketplaces | 200 (marketing page; not relied on for eligibility) |

Linked articles that were *not* fetched (e.g. billing methods, payment protection, work diary, disputes, Job Success Score, Featured Jobs, boosted proposals) are **not verified** in this audit.

## Feature matrix

### A. Accounts & identity

| Feature | Confirmed (source) | WorkSpring interpretation (inferred / own) | Decision | Phase / status |
|---|---|---|---|---|
| One login can be both client and freelancer | S2: "If you already have a freelancer account, you can add a client profile with the same login" | One `users` row; capabilities in `user_capabilities` (client, freelancer); active mode stored on the session; no duplicate accounts | parity | P1 – Built (R1) |
| Phone verification and/or billing method before posting / hiring | S1, S2 ("You won't be able to hire until this step is done") | WorkSpring requires **email verification** before posting jobs, submitting proposals or sending offers. Phone verification not built; never shown as a badge | adapted | Email: Built (R1). Phone: Planned (P9) |
| Company profile (name, tagline, description, logo); no personal contact details | S2 | Client company name on profile; company/team accounts later | adapted | Company name: Built (R1). Teams: Planned (P9) |
| KYC identity confirmation may be requested at proposal time | S4 ("Know Your Customer process") | Not built. No identity badge exists anywhere. Requires a regulated provider | not included (needs provider/legal) | Planned (P9) |

### B. Job posting (client)

| Feature | Confirmed (source) | WorkSpring interpretation | Decision | Phase / status |
|---|---|---|---|---|
| Job title, skills (up to 10, 3–5 recommended), scope (small/medium/large), expertise level (entry/intermediate/expert), location, budget, description | S1 | Fields: title, description, category, skills (max 10, from normalized taxonomy), scope (small/medium/large), experience (entry/intermediate/expert), contract type, budget/rate range in minor units, location note | parity (fields), original UI/copy | P3 – Built (R1) |
| Hourly vs fixed-price at posting; fixed budget is a rough estimate; milestones set at offer time | S1, S9 | Same model: job budget is indicative; binding terms live in the offer snapshot | parity | Built (R1) |
| Privacy guidance: don't include personal contact info, external links, off-platform payment requests | S1 | Job form shows a privacy warning; server rejects obvious emails/phone numbers in job descriptions (heuristic, documented) | adapted | Built (R1) |
| Job must be in English | S1 | **Not adopted.** WorkSpring has no language requirement in R1 | adapted | — |
| AI job post generator ("Uma") | S1 | Not built; optional AI module later, must require user approval | not included | Planned (P13 module) |
| Featured jobs (paid visibility) | S1, S5 | Not built; any paid visibility would need its own disclosed policy | not included | Planned |
| Edit / close / repost job | S1 mentions editing later; linked "edit or close" and "repost" articles not fetched | Draft → open → paused → closed; reopen from paused | adapted (details of reference not verified) | Built (R1): publish, pause, reopen, close |
| After posting: billing verification, job appears in marketplace, review proposals/interview/hire | S1 | Published jobs appear in Postgres full-text search; billing not required in test mode | adapted | Built (R1) |

### C. Find work & proposals (freelancer)

| Feature | Confirmed (source) | WorkSpring interpretation | Decision | Phase / status |
|---|---|---|---|---|
| Apply from job page; choose freelancer vs agency capacity | S4 | Freelancer capacity only in R1; agency capacity later | adapted | Built (R1) individual only |
| Terms: hourly rate or fixed bid; paid by project or milestone; duration estimate | S4 | Proposal stores rate (hourly) or bid (fixed) in minor units + duration estimate; immutable `terms_snapshot` JSON + `proposal_events` | parity | Built (R1) |
| Cover letter with questions/next steps | S4 | Cover letter (50–5000 chars) | parity | Built (R1) |
| Screening question answers | S4 | Not built in R1 | — | Planned (P3) |
| Profile highlights / work samples | S4 | Not built in R1 | — | Planned (P3) |
| Proposals cost "Connects"; boosting with Connects | S4 | **Not adopted.** WorkSpring R1 has no application credits and no boosting. Any future boost must disclose cost/ranking/refund rules (spec §6.4) | adapted | — |
| Edit most parts within 6 hours or until client views; terms editable until accept/reject | S4 | R1: proposals cannot be edited; freelancer can withdraw while `submitted`/`shortlisted`. Edit-with-revision-history planned | adapted | Withdraw: Built (R1). Edit: Planned |
| Spam / repeated contact is against ToS | S4 | Rate limiting planned; one active proposal per freelancer per job enforced by DB unique index | adapted | Partial (R1) |

### D. Invitations

| Feature | Confirmed (source) | WorkSpring interpretation | Decision | Phase / status |
|---|---|---|---|---|
| Invite a freelancer from profile/search with message + job | S5 | `proposal_invites` table planned | parity | Planned (P3) |
| 30 invites per standard job; more via Featured Job | S5 | WorkSpring will define its own limit | adapted | Planned |
| Invitation status visible to client | S5 | Planned | parity | Planned |

### E. Messages

| Feature | Confirmed (source) | WorkSpring interpretation | Decision | Phase / status |
|---|---|---|---|---|
| Conversation room created when client messages a freelancer or responds to a proposal | S6 | Client can open a conversation from a proposal; conversation is linked to the proposal/job; every read/write checks `conversation_members` | parity | Built (R1) |
| No sharing contact/payment info before a contract | S6 | WorkSpring policy text shown in messages; not machine-enforced in R1 | adapted | Notice: Built (R1) |
| Edit within 2 h, delete within 1 h, visible edit marker | S6 (the page says "two hours" for edit in one place and "one hour" in the shortcuts table — inconsistent on the source page) | Not built in R1 | — | Planned (P4) |
| Attachments up to 1 GB, file search | S6 | Not built in R1 (needs private object storage) | — | Planned (P4) |
| Block (not possible with active-contract counterpart), report message, mute/notifications cadence (default 15-min email digests) | S6 | Planned | adapted | Planned (P4) |
| Team members in conversations; owner/admin/member roles | S6 | Planned with company/agency teams | parity | Planned (P9) |
| Zoom / video calls, Loom recordings | S6 | Video via provider adapter (e.g. LiveKit) later | not included | Planned (P4) |
| Activity timeline for proposal in the conversation sidebar | S6 | Proposal status shown in thread header | adapted | Built (R1, basic) |

### F. Offers & contracts

| Feature | Confirmed (source) | WorkSpring interpretation | Decision | Phase / status |
|---|---|---|---|---|
| Client hires from job post by sending an offer with title, description, payment terms | S3 | Offer from a proposal; terms snapshot (type, amount/rate, currency, milestones) | parity | Built (R1) fixed-price; hourly offers: Planned |
| Freelancer can accept, decline, or message to negotiate | S3 | Accept (transaction with row lock, creates exactly one contract) / decline | parity | Built (R1) |
| Offer expires after 30 days | S3 | Offers carry `expires_at` (14 days, WorkSpring's own choice); accept after expiry rejected server-side | adapted | Built (R1) |
| Client can modify or withdraw before acceptance; resend after cancel | S3 | Withdraw before acceptance: Built. Modify = withdraw + new offer (each immutable) | adapted | Built (R1) |
| Agency offers paid to agency | S3 | Planned with agencies | parity | Planned (P9) |

### G. Fixed-price vs hourly

| Feature | Confirmed (source) | WorkSpring interpretation | Decision | Phase / status |
|---|---|---|---|---|
| Hourly: $3/h minimum; weekly billing; work diary via desktop app; weekly limit; disputes window | S9 | WorkSpring minimums: own config. Hourly/time diary **not built**; web timer must never be presented as desktop tracking | adapted | Planned (P6) |
| Fixed-price: $5 minimum; milestones; funds deposited into **escrow**; 14 days to approve or request changes | S9, S2 | WorkSpring **does not offer escrow**. Milestone "funding" means a provider-confirmed payment (test provider in R1) recorded in a ledger; UI never says "escrow" or "protected". Review window: configurable, not enforced automatically in R1 | adapted (legal) | Built (R1) with test provider |
| Payment protection programmes | S3, S9 | **Not offered.** No protection claims anywhere | not included (legal) | — |
| Contract Initiation Fee | S2 | WorkSpring defines its own versioned fee rule (`platform_fee_rules`); currently 10% freelancer service fee in test mode, snapshotted per contract | adapted | Built (R1) |

### H. Project Catalog → WorkSpring "Services"

| Feature | Confirmed (source) | WorkSpring interpretation | Decision | Phase / status |
|---|---|---|---|---|
| Pre-scoped projects with pricing, scope, timing; search by category; save (heart); message before buying | S7, S2 | Services catalog module | parity (shape) | Planned (P7) |
| Up to 3 tiers (Starter/Standard/Advanced), add-ons, $5–$500,000, delivery days, revisions, gallery, requirements, summary, steps, FAQ, up to 5 tags, max 20 concurrent | S8 | Same field families with WorkSpring limits | parity (shape) | Planned (P7) |
| Moderation: under review → approved / needs changes; visibility toggle | S8 | Draft → submitted → published / changes requested / paused / archived | parity | Planned (P7) |

### I. Agencies

| Feature | Confirmed (source) | WorkSpring interpretation | Decision | Phase / status |
|---|---|---|---|---|
| Agency = group of freelancers under one profile; owner/manager assigns work; agency distributes earnings | S10 | First-class optional module; members keep separate identities | parity (shape) | Planned (P9) |
| One agency per freelancer; adding members requires paid "Agency Plus" | S10 | WorkSpring will define its own rule; no paid gate decided | adapted | Planned |
| Roles: agency manager, finance admin, account admin, work-diary access, team/company chat access, API key manager, exclusive contractor | S11 | WorkSpring roles: owner, admin, recruiter/PM, finance, contributor (spec §12) | adapted | Planned (P9) |

## Gaps and limitations

- Only 11 help articles were verified. Anything they link to (payment protection, work diary, disputes, JSS, Connects pricing, Featured Jobs) is unverified and must not be cited as fact.
- Public help pages describe behavior but not internal rules (ranking, fraud, review windows edge cases); WorkSpring designs these itself.
- No screenshots were collected, by choice: WorkSpring's UI is original and must not copy page composition.
- Payment, escrow, KYC and payout features depend on provider contracts and legal review in the platform's jurisdiction (see `PAYMENTS_AND_LEDGER.md`).
