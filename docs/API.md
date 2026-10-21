# JSON API (R1)

Route handlers in `src/app/api/**` are thin wrappers over the service layer (the same functions the server actions use). The web UI itself uses server actions; this API exists for integrations and tests.

**Conventions**
- Auth: session cookie `ws_session` (httpOnly). Obtain it via `POST /api/auth/login` or `/api/auth/register`.
- CSRF: every non-GET request except webhooks must send an `Origin` header matching the host (403 otherwise).
- Success: `200 {"data": …}`. Errors: `{"error":{"code","message","fieldErrors?"}}` with status:
  `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND` (also used for resources you may not see), `409 CONFLICT | INVALID_TRANSITION`, `422 VALIDATION`, `429 RATE_LIMITED`, `503 PROVIDER_UNCONFIGURED`, `400 BAD_SIGNATURE`, `500 INTERNAL`.
- Amounts in requests are decimal **strings** in major units (e.g. `"1250.50"`); responses use integer `*_minor` / `*Minor` fields plus `currency`.
- Pagination: `page` (1-based), fixed `pageSize` 10; responses include `total`, `page`, `pageSize`.
- Rate limits (R1): login 8 attempts / 10 min / email (per process); messages 20/min/user (DB-backed). Others: planned.

| Method & path | Auth / permission | Body / query | Notes |
|---|---|---|---|
| GET `/api/health` | public | — | DB check + payment provider state |
| POST `/api/auth/register` | public | `{email,password(≥10),displayName,intent:"hire"\|"work"}` | sets cookie; verification email queued |
| POST `/api/auth/login` | public | `{email,password}` | sets cookie; generic error on bad credentials |
| POST `/api/auth/logout` | any | — | deletes session row + cookie |
| GET `/api/me` | signed in | — | current actor (id, email, capabilities, activeMode, emailVerified) |
| GET `/api/jobs` | public | `q,category,skill,type(fixed\|hourly),level,minBudget,sort(relevance\|newest\|budget_desc),page` | open jobs only; Postgres FTS |
| POST `/api/jobs` | client capability | `{title,description,categorySlug,skills[],contractType,currency,budgetMin?,budgetMax,scope,experienceLevel,locationNote?}` | creates **draft** |
| GET `/api/jobs/:id` | owner only | — | includes events |
| PATCH `/api/jobs/:id` | owner only | same as create | not when closed |
| POST `/api/jobs/:id/transition` | owner; verified email to open | `{to:"open"\|"paused"\|"closed"}` | state machine |
| GET `/api/jobs/:id/proposals` | owner only | — | excludes withdrawn |
| GET `/api/proposals` | freelancer | — | caller's proposals |
| POST `/api/proposals` | freelancer, verified, published profile | `{jobId,coverLetter(50–5000),amount,durationEstimate}` | 409 if duplicate active proposal / job not open / own job |
| GET `/api/proposals/:id` | author or job owner | — | 404 otherwise |
| POST `/api/proposals/:id/withdraw` | author | — | not while offer pending |
| GET `/api/offers` | signed in | — | offers sent or received |
| POST `/api/offers` | job owner, verified | `{proposalId,title,description,milestones:[{title,amount,dueDate?}]}` | fixed-price only; 14-day expiry |
| POST `/api/offers/:id/accept` | offer's freelancer | — | transactional; returns `{contract}` |
| POST `/api/offers/:id/decline` | offer's freelancer | — | proposal → withdrawn |
| POST `/api/offers/:id/withdraw` | offer's client | — | proposal → shortlisted |
| GET `/api/contracts/:id` | participants | — | workroom: milestones, submissions, revisions, events, payment intents, ledger |
| POST `/api/milestones/:id/fund` | contract client | — | returns `{intentId, actionUrl}`; state `funding_pending` |
| POST `/api/milestones/:id/deliver` | contract freelancer | `{note}` | from funded / revision_requested |
| POST `/api/milestones/:id/request-revision` | contract client | `{note}` | from submitted |
| POST `/api/milestones/:id/approve` | contract client | — | approves and requests the release transfer |
| POST `/api/milestones/:id/release` | contract client | — | retry after a failed transfer |
| GET `/api/conversations/:id/messages` | members only | — | latest 100 |
| POST `/api/conversations/:id/messages` | members only | `{body(1–5000)}` | throttled |
| POST `/api/provider-webhooks/:provider` | provider signature | raw JSON | no cookie/CSRF; ≤64 KB; see `PAYMENTS_AND_LEDGER.md` |

Conversation creation is UI-only in R1 (server action `openConversationAction`, client from a proposal).

**Audit / events**: job, proposal, offer, contract and milestone transitions write event rows with actor; auth and profile actions write `audit_log`.
