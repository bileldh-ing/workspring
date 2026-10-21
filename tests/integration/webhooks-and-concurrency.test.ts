import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { contracts, ledgerEntries, milestones, offers, paymentIntents, providerWebhookEvents } from "@/db/schema";
import type { Actor } from "@/domain/permissions";
import { getPaymentProvider } from "@/server/payments";
import { signPayload, TEST_SIGNATURE_HEADER } from "@/server/payments/test-provider";
import { acceptOffer, createOffer, fundMilestone } from "@/server/services/contracts";
import { createJob, transitionJob } from "@/server/services/jobs";
import { buildSignedTestEvent, processWebhook } from "@/server/services/payments";
import { saveProfile, setProfileVisibility } from "@/server/services/profiles";
import { submitProposal, withdrawProposal } from "@/server/services/proposals";
import { closeTestDb, jobInput, LONG, makeUser, profileInput, resetDb, testDb } from "../helpers";

const db = testDb();
const SECRET = process.env.TEST_PROVIDER_WEBHOOK_SECRET!;
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

async function freelancerWithProfile() {
  const f = await makeUser(db, "work");
  await saveProfile(db, f, profileInput());
  await setProfileVisibility(db, f, true);
  return f;
}
async function openJob(client: Actor) {
  const j = await createJob(db, client, jobInput());
  await transitionJob(db, client, j.id, "open");
  return j;
}
const propose = (f: Actor, jobId: string) =>
  submitProposal(db, f, { jobId, coverLetter: LONG("Experienced, available and ready to start."), amount: "1000", durationEstimate: "1_to_4_weeks" });
const offer = (client: Actor, proposalId: string) =>
  createOffer(db, client, { proposalId, title: "Fixed price build", description: "A fixed-price scope for the test.", milestones: [{ title: "All work", amount: "1000" }] });

async function fundedSetup() {
  const client = await makeUser(db, "hire");
  const f = await freelancerWithProfile();
  const j = await openJob(client);
  const p = await propose(f, j.id);
  const o = await offer(client, p.id);
  const c = await acceptOffer(db, f, o.id);
  const [m] = await db.select().from(milestones).where(eq(milestones.contractId, c.id));
  const { intentId } = await fundMilestone(db, client, m.id);
  const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId));
  return { client, f, m, intent };
}

describe("provider webhooks", () => {
  it("replayed webhook (same event id) does not double-post the ledger", async () => {
    const { m, intent } = await fundedSetup();
    const evt = buildSignedTestEvent(intent, "succeeded", SECRET, "evt_replay_0001");
    expect((await processWebhook(db, "test", evt.body, evt.headers)).outcome).toBe("applied");
    expect((await processWebhook(db, "test", evt.body, evt.headers)).outcome).toBe("duplicate");
    // Concurrent duplicate deliveries are serialized too.
    const again = buildSignedTestEvent(intent, "succeeded", SECRET, "evt_replay_0001");
    const outcomes = await Promise.all([1, 2, 3].map(() => processWebhook(db, "test", again.body, again.headers)));
    expect(outcomes.every((o) => o.outcome === "duplicate")).toBe(true);
    expect(await db.select().from(ledgerEntries)).toHaveLength(2);
    expect(await db.select().from(providerWebhookEvents)).toHaveLength(1);
    expect((await db.select().from(milestones).where(eq(milestones.id, m.id)))[0].status).toBe("funded");
  });

  it("a different event for an already-final payment (out of order) is ignored", async () => {
    const { m, intent } = await fundedSetup();
    const ok = buildSignedTestEvent(intent, "succeeded", SECRET);
    await processWebhook(db, "test", ok.body, ok.headers);
    const late = buildSignedTestEvent(intent, "failed", SECRET);
    expect((await processWebhook(db, "test", late.body, late.headers)).outcome).toBe("already_final");
    expect((await db.select().from(milestones).where(eq(milestones.id, m.id)))[0].status).toBe("funded");
  });

  it("bad signatures are rejected before touching the database", async () => {
    const { intent } = await fundedSetup();
    const evt = buildSignedTestEvent(intent, "succeeded", "a-completely-different-secret-value-xyz");
    await expect(processWebhook(db, "test", evt.body, evt.headers)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
    await expect(processWebhook(db, "test", evt.body, new Headers())).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
    expect(await db.select().from(providerWebhookEvents)).toHaveLength(0);
    expect((await db.select().from(paymentIntents))[0].status).toBe("requires_action");
  });

  it("amount mismatches are recorded but never applied", async () => {
    const { m, intent } = await fundedSetup();
    const body = JSON.stringify({ id: "evt_mismatch_01", type: "payment.succeeded", providerRef: intent.providerRef, amountMinor: 1, currency: "USD", created: Math.floor(Date.now() / 1000) });
    const r = await processWebhook(db, "test", body, new Headers({ [TEST_SIGNATURE_HEADER]: signPayload(body, SECRET) }));
    expect(r.outcome).toBe("amount_mismatch");
    expect((await db.select().from(milestones).where(eq(milestones.id, m.id)))[0].status).toBe("funding_pending");
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("failed payment returns the milestone to unfunded with no ledger entries", async () => {
    const { m, intent } = await fundedSetup();
    const evt = buildSignedTestEvent(intent, "failed", SECRET);
    await processWebhook(db, "test", evt.body, evt.headers);
    expect((await db.select().from(milestones).where(eq(milestones.id, m.id)))[0].status).toBe("unfunded");
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("unconfigured provider refuses instead of faking success", async () => {
    const { client, m } = await fundedSetup().then(async (s) => s);
    const prev = process.env.PAYMENTS_PROVIDER;
    process.env.PAYMENTS_PROVIDER = "stripe";
    try {
      const p = getPaymentProvider();
      expect(p.configured).toBe(false);
      await expect(fundMilestone(db, client, m.id, p)).rejects.toMatchObject({ code: "PROVIDER_UNCONFIGURED" });
    } finally {
      process.env.PAYMENTS_PROVIDER = prev;
    }
  });
});

describe("concurrency and lifecycle guards", () => {
  it("concurrent acceptance of two offers on one job yields exactly one contract", async () => {
    const client = await makeUser(db, "hire");
    const [a, b] = [await freelancerWithProfile(), await freelancerWithProfile()];
    const j = await openJob(client);
    const oa = await offer(client, (await propose(a, j.id)).id);
    const ob = await offer(client, (await propose(b, j.id)).id);
    const results = await Promise.allSettled([acceptOffer(db, a, oa.id), acceptOffer(db, b, ob.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["CONFLICT", "INVALID_TRANSITION"]).toContain(rejected.reason.code);
    expect(await db.select().from(contracts)).toHaveLength(1);
  });

  it("the same offer accepted twice concurrently creates one contract", async () => {
    const client = await makeUser(db, "hire");
    const f = await freelancerWithProfile();
    const j = await openJob(client);
    const o = await offer(client, (await propose(f, j.id)).id);
    const results = await Promise.allSettled([acceptOffer(db, f, o.id), acceptOffer(db, f, o.id), acceptOffer(db, f, o.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(contracts)).toHaveLength(1);
  });

  it("cannot hire from a withdrawn proposal", async () => {
    const client = await makeUser(db, "hire");
    const f = await freelancerWithProfile();
    const j = await openJob(client);
    const p = await propose(f, j.id);
    await withdrawProposal(db, f, p.id);
    await expect(offer(client, p.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("an expired offer cannot be accepted and is marked expired", async () => {
    const client = await makeUser(db, "hire");
    const f = await freelancerWithProfile();
    const j = await openJob(client);
    const o = await offer(client, (await propose(f, j.id)).id);
    await db.update(offers).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(offers.id, o.id));
    await expect(acceptOffer(db, f, o.id)).rejects.toThrow(/expired/);
    expect((await db.select().from(offers).where(eq(offers.id, o.id)))[0].status).toBe("expired");
    expect(await db.select().from(contracts)).toHaveLength(0);
  });

  it("cannot apply to your own job and closed jobs reject proposals", async () => {
    const both = await makeUser(db, "hire");
    const j = await openJob(both);
    await db.execute(sql`insert into user_capabilities (user_id, capability) values (${both.userId}, 'freelancer')`);
    await saveProfile(db, { ...both, capabilities: ["client", "freelancer"] }, profileInput());
    await setProfileVisibility(db, { ...both, capabilities: ["client", "freelancer"] }, true);
    await expect(propose({ ...both, capabilities: ["client", "freelancer"] }, j.id)).rejects.toThrow(/own job/);
    await transitionJob(db, both, j.id, "closed");
    const f = await freelancerWithProfile();
    await expect(propose(f, j.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
