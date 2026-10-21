// End-to-end HTTP smoke test of the main path against a RUNNING server (no browser).
// Usage: BASE_URL=http://localhost:3000 TEST_PROVIDER_WEBHOOK_SECRET=... node tests/http/api-flow.mjs
// Requires ENABLE_DEV_OUTBOX=true (or a dev server) so verification links can be read from /dev/outbox.
import { createHmac, randomUUID } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.TEST_PROVIDER_WEBHOOK_SECRET;
if (!SECRET) throw new Error("TEST_PROVIDER_WEBHOOK_SECRET required");
const results = [];
const step = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) process.exitCode = 1; };

function client() {
  let cookie = "";
  return async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...extraHeaders },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set && set.includes("ws_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };
}

async function verify(email) {
  const html = await (await fetch(`${BASE}/dev/outbox`)).text();
  const idx = html.indexOf(email);
  const m = html.slice(idx, idx + 4000).match(/\/verify-email\?token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("verification link not found for " + email);
  const r = await fetch(`${BASE}/verify-email?token=${m[1]}`);
  return r.status;
}

function signed(body) {
  const t = Math.floor(Date.now() / 1000);
  return { "x-workspring-test-signature": `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}` };
}

const run = randomUUID().slice(0, 8);
const C = client(), F = client(), X = client();
const cEmail = `http-client-${run}@example.test`, fEmail = `http-free-${run}@example.test`, xEmail = `http-other-${run}@example.test`;

let r = await C("POST", "/api/auth/register", { email: cEmail, password: "http-test-password", displayName: "HTTP Client", intent: "hire" });
step("client registers (cookie session)", r.status === 200, r.status);
r = await F("POST", "/api/auth/register", { email: fEmail, password: "http-test-password", displayName: "HTTP Freelancer", intent: "work" });
step("freelancer registers", r.status === 200);
await X("POST", "/api/auth/register", { email: xEmail, password: "http-test-password", displayName: "HTTP Outsider", intent: "hire" });

r = await C("POST", "/api/jobs", { title: "HTTP smoke test job for API flow", description: "x".repeat(10) + " Build a small dashboard with React and PostgreSQL, with tests and docs.", categorySlug: "web-mobile-dev", skills: ["react", "postgresql"], contractType: "fixed", currency: "USD", budgetMax: "900", scope: "small", experienceLevel: "intermediate" });
const jobId = r.json?.data?.id;
step("client creates draft job", r.status === 200 && !!jobId);
r = await C("POST", `/api/jobs/${jobId}/transition`, { to: "open" });
step("unverified client cannot publish (403)", r.status === 403, r.json?.error?.message);
step("email verification link from outbox works", (await verify(cEmail)) === 200 && (await verify(fEmail)) === 200);
r = await C("POST", `/api/jobs/${jobId}/transition`, { to: "open" });
step("verified client publishes job", r.status === 200 && r.json.data.to === "open");
r = await C("POST", `/api/jobs/${jobId}/transition`, { to: "draft" });
step("invalid transition open→draft rejected (422/409)", r.status === 422 || r.status === 409, r.status);

r = await F("GET", `/api/jobs?q=${encodeURIComponent("smoke dashboard")}&skill=react`);
step("full-text search finds the published job", r.json?.data?.results?.some((j) => j.id === jobId));

r = await F("POST", "/api/proposals", { jobId, coverLetter: "I can deliver this dashboard quickly with tests, docs and a clear handover. ".repeat(2), amount: "850", durationEstimate: "1_to_4_weeks" });
step("proposal blocked until profile is published (403)", r.status === 403 && /profile/.test(r.json?.error?.message ?? ""), r.json?.error?.message);
r = await F("PUT", "/api/freelancer-profile", { title: "HTTP test freelancer", overview: "I build dashboards with React and PostgreSQL, with tests and clear documentation for clients.", hourlyRate: "40", currency: "USD", timezone: "Africa/Tunis", availability: "available", experienceLevel: "intermediate", categorySlug: "web-mobile-dev", skills: ["react", "postgresql"] });
step("freelancer saves draft profile", r.status === 200 && r.json.data.status === "draft", r.json?.error?.message);
r = await F("POST", "/api/freelancer-profile/publish", { publish: true });
step("freelancer publishes profile", r.status === 200);
const D = F;
r = await D("POST", "/api/proposals", { jobId, coverLetter: "I can deliver this dashboard quickly with tests, docs and a clear handover. ".repeat(2), amount: "850", durationEstimate: "1_to_4_weeks" });
const proposalId = r.json?.data?.id;
step("published freelancer submits proposal", r.status === 200 && !!proposalId, r.json?.error?.message);
r = await X("GET", `/api/proposals/${proposalId}`);
step("outsider cannot read the proposal (404)", r.status === 404);
r = await C("GET", `/api/jobs/${jobId}/proposals`);
step("client lists proposals for own job", r.json?.data?.length === 1);

r = await C("POST", "/api/offers", { proposalId, title: "HTTP smoke contract", description: "Fixed-price scope for the smoke test.", milestones: [{ title: "Everything", amount: "850" }] });
const offerId = r.json?.data?.id;
step("client sends fixed-price offer", r.status === 200 && !!offerId, r.json?.error?.message);
r = await C("POST", `/api/offers/${offerId}/accept`);
step("client cannot accept own offer (403/404)", r.status === 403 || r.status === 404, r.status);
r = await D("POST", `/api/offers/${offerId}/accept`);
const contractId = r.json?.data?.contract?.id;
step("freelancer accepts → contract", r.status === 200 && !!contractId);
r = await D("POST", `/api/offers/${offerId}/accept`);
step("second accept rejected (409)", r.status === 409);

r = await C("GET", `/api/contracts/${contractId}`);
const milestoneId = r.json?.data?.milestones?.[0]?.id;
step("workroom visible to client", r.status === 200 && !!milestoneId);
r = await X("GET", `/api/contracts/${contractId}`);
step("workroom hidden from outsider (404)", r.status === 404);

r = await C("POST", `/api/milestones/${milestoneId}/fund`);
const intentId = r.json?.data?.intentId;
step("fund → funding_pending + checkout URL", r.status === 200 && r.json.data.actionUrl?.includes("/test-provider/checkout/"));
r = await D("POST", `/api/milestones/${milestoneId}/deliver`, { note: "Trying to deliver before funding is confirmed" });
step("delivery before provider confirmation rejected (409)", r.status === 409);

const payBody = JSON.stringify({ id: `evt_http_${run}`, type: "payment.succeeded", providerRef: `tp_pay_${intentId}`, amountMinor: 85000, currency: "USD", created: Math.floor(Date.now() / 1000) });
r = await fetch(`${BASE}/api/provider-webhooks/test`, { method: "POST", headers: { "content-type": "application/json", "x-workspring-test-signature": "t=1,v1=" + "0".repeat(64) }, body: payBody });
step("webhook with bad signature rejected (400)", r.status === 400);
r = await fetch(`${BASE}/api/provider-webhooks/test`, { method: "POST", headers: { "content-type": "application/json", ...signed(payBody) }, body: payBody });
let j = await r.json();
step("signed payment.succeeded webhook applied", r.status === 200 && j.data.outcome === "applied", j.data?.outcome);
r = await fetch(`${BASE}/api/provider-webhooks/test`, { method: "POST", headers: { "content-type": "application/json", ...signed(payBody) }, body: payBody });
j = await r.json();
step("replayed webhook is a duplicate no-op", j.data?.outcome === "duplicate");

r = await D("POST", `/api/milestones/${milestoneId}/deliver`, { note: "First delivery of the dashboard, please review." });
step("freelancer delivers", r.status === 200);
r = await C("POST", `/api/milestones/${milestoneId}/request-revision`, { note: "Please add the export button." });
step("client requests revision", r.status === 200);
r = await D("POST", `/api/milestones/${milestoneId}/deliver`, { note: "Added the export button, v2." });
step("freelancer resubmits (v2)", r.status === 200 && r.json.data.version === 2);
r = await C("POST", `/api/milestones/${milestoneId}/approve`);
const rel = r.json?.data;
step("client approves → release_pending (fee 10%)", r.status === 200 && rel.feeMinor === 8500 && rel.netMinor === 76500);
const trBody = JSON.stringify({ id: `evt_http_tr_${run}`, type: "transfer.succeeded", providerRef: `tp_tr_${rel.intentId}`, amountMinor: 76500, currency: "USD", created: Math.floor(Date.now() / 1000) });
r = await fetch(`${BASE}/api/provider-webhooks/test`, { method: "POST", headers: { "content-type": "application/json", ...signed(trBody) }, body: trBody });
step("signed transfer.succeeded webhook applied", (await r.json()).data?.outcome === "applied");
r = await C("GET", `/api/contracts/${contractId}`);
const w = r.json.data;
step("milestone released and contract completed", w.milestones[0].status === "released" && w.contract.status === "completed");
const sum = (acc, dir) => w.ledger.filter((l) => l.account === acc && l.direction === dir).reduce((a, l) => a + l.amountMinor, 0);
step("ledger: 5 balanced entries, fee revenue 8500", w.ledger.length === 5 && sum("platform_fee_revenue", "credit") === 8500 && sum("milestone_payable", "debit") === sum("milestone_payable", "credit"));

const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} HTTP checks passed`);
