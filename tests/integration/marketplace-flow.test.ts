import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contracts, jobs, ledgerEntries, milestones } from "@/db/schema";
import { getActorByUserId } from "@/server/services/auth";
import { acceptOffer, approveMilestone, createOffer, deliverMilestone, fundMilestone, getWorkroom, requestRevision } from "@/server/services/contracts";
import { createJob, searchJobs, transitionJob } from "@/server/services/jobs";
import { getConversation, openProposalConversation, postMessage } from "@/server/services/messaging";
import { simulateTestProviderOutcome } from "@/server/services/payments";
import { getPublicProfile, saveProfile, searchTalent, setProfileVisibility } from "@/server/services/profiles";
import { getProposal, listJobProposals, setProposalReview, submitProposal } from "@/server/services/proposals";
import { closeTestDb, jobInput, LONG, makeUser, profileInput, resetDb, testDb } from "../helpers";

const db = testDb();
beforeAll(() => resetDb(db));
afterAll(() => closeTestDb());

describe("genuine first path: profile → job → search → proposal → message → offer → contract → milestones → release", () => {
  it("runs end to end with server-side state transitions, events and a balanced ledger", async () => {
    const client = await makeUser(db, "hire", { name: "Clara Client" });
    let freelancer = await makeUser(db, "work", { name: "Farid Freelancer" });

    // Freelancer profile: draft → published → public SSR data (no email)
    await saveProfile(db, freelancer, profileInput());
    await setProfileVisibility(db, freelancer, true);
    freelancer = (await getActorByUserId(db, freelancer.userId))!;
    const talent = await searchTalent(db, { q: "postgresql", skill: "", level: "", page: 1 });
    expect(talent.results.map((r) => r.user_id)).toContain(freelancer.userId);
    const pub = await getPublicProfile(db, talent.results[0].slug);
    expect(pub).not.toHaveProperty("email");
    expect(pub!.completedContracts).toBe(0);

    // Job: draft is invisible to search; publish → found by full-text + filters
    const job = await createJob(db, client, jobInput());
    expect((await searchJobs(db, { q: "invoicing", category: "", skill: "", type: "", level: "", sort: "relevance", page: 1 })).total).toBe(0);
    await transitionJob(db, client, job.id, "open");
    const found = await searchJobs(db, { q: "invoicing dashboard", category: "web-dev", skill: "react", type: "fixed", level: "", minBudget: 1000, sort: "relevance", page: 1 });
    expect(found.results.map((r) => r.id)).toEqual([job.id]);
    expect((await searchJobs(db, { q: "invoicing", category: "", skill: "", type: "hourly", level: "", sort: "relevance", page: 1 })).total).toBe(0);

    // Proposal
    const proposal = await submitProposal(db, freelancer, { jobId: job.id, coverLetter: LONG("I have shipped three invoicing dashboards in React."), amount: "1200", durationEstimate: "1_to_4_weeks" });
    expect(proposal.amountMinor).toBe(120000);
    await expect(submitProposal(db, freelancer, { jobId: job.id, coverLetter: LONG("Second try at the same job, please."), amount: "1100", durationEstimate: "1_to_4_weeks" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await listJobProposals(db, client, job.id)).toHaveLength(1);
    await setProposalReview(db, client, proposal.id, "shortlist");

    // Messaging (persisted, membership-checked)
    const conv = await openProposalConversation(db, client, proposal.id);
    expect((await openProposalConversation(db, client, proposal.id)).id).toBe(conv.id); // idempotent
    await postMessage(db, client, conv.id, { body: "Hi Farid, can you start Monday?" });
    await postMessage(db, freelancer, conv.id, { body: "Yes, Monday works." });
    expect((await getConversation(db, freelancer, conv.id)).messages.map((m) => m.body)).toEqual(["Hi Farid, can you start Monday?", "Yes, Monday works."]);

    // Offer → accept (contract is not active before acceptance)
    const offer = await createOffer(db, client, {
      proposalId: proposal.id,
      title: "Invoicing dashboard build",
      description: "Dashboard with filters, CSV export and tests.",
      milestones: [{ title: "UI and filters", amount: "700" }, { title: "Exports and tests", amount: "500.50", dueDate: "2026-12-01" }],
    });
    expect(offer.totalMinor).toBe(120050);
    expect(await db.select().from(contracts)).toHaveLength(0);
    expect((await getProposal(db, freelancer, proposal.id)).p.status).toBe("offer_sent");
    const contract = await acceptOffer(db, freelancer, offer.id);
    expect(contract.status).toBe("active");
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].status).toBe("closed");
    expect((await getProposal(db, client, proposal.id)).p.status).toBe("hired");

    const [m1, m2] = await db.select().from(milestones).where(eq(milestones.contractId, contract.id)).orderBy(milestones.seq);
    await expect(deliverMilestone(db, freelancer, m1.id, { note: "Work before funding should be impossible" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(fundMilestone(db, client, m2.id)).rejects.toThrow(/earlier milestones/);

    // Funding: pending until a verified webhook; repeat click returns the same intent
    const f1 = await fundMilestone(db, client, m1.id);
    expect(f1.actionUrl).toBe(`/test-provider/checkout/${f1.intentId}`);
    expect((await fundMilestone(db, client, m1.id)).intentId).toBe(f1.intentId);
    let room = await getWorkroom(db, client, contract.id);
    expect(room.milestones[0].status).toBe("funding_pending");
    expect(room.ledger).toHaveLength(0);
    expect((await simulateTestProviderOutcome(db, client, f1.intentId, "succeeded")).outcome).toBe("applied");
    room = await getWorkroom(db, freelancer, contract.id);
    expect(room.milestones[0].status).toBe("funded");
    expect(room.ledger.map((l) => [l.account, l.direction, l.amountMinor, l.mode])).toEqual([
      ["provider_balance", "debit", 70000, "test"],
      ["milestone_payable", "credit", 70000, "test"],
    ]);

    // Deliver → revision → redeliver → approve → release (webhook)
    await deliverMilestone(db, freelancer, m1.id, { note: "First version of the UI is ready for review." });
    await requestRevision(db, client, m1.id, { note: "Please add a date range filter." });
    await deliverMilestone(db, freelancer, m1.id, { note: "Added the date range filter, v2." });
    const rel = await approveMilestone(db, client, m1.id);
    expect(rel).toMatchObject({ grossMinor: 70000, feeMinor: 7000, netMinor: 63000 });
    room = await getWorkroom(db, client, contract.id);
    expect(room.milestones[0].status).toBe("release_pending");
    expect(room.milestones[0].submissions.map((s) => s.version)).toEqual([1, 2]);
    expect(room.milestones[0].revisions).toHaveLength(1);
    await simulateTestProviderOutcome(db, client, rel.intentId, "succeeded");
    room = await getWorkroom(db, client, contract.id);
    expect(room.milestones[0].status).toBe("released");
    expect(room.contract.status).toBe("active"); // milestone 2 still open

    // Milestone 2 through to completion
    const f2 = await fundMilestone(db, client, m2.id);
    await simulateTestProviderOutcome(db, client, f2.intentId, "succeeded");
    await deliverMilestone(db, freelancer, m2.id, { note: "Exports and the test suite are done." });
    const rel2 = await approveMilestone(db, client, m2.id);
    await simulateTestProviderOutcome(db, freelancer, rel2.intentId, "succeeded");
    room = await getWorkroom(db, client, contract.id);
    expect(room.contract.status).toBe("completed");
    expect(room.milestones[0].events.some((e) => e.actorKind === "provider_webhook" && e.toStatus === "funded")).toBe(true);

    // Ledger: every transaction balances; platform keeps exactly the fee; payable fully released
    const unbalanced = await db.execute(sql`
      select transaction_id from ledger_entries group by transaction_id
      having sum(case when direction = 'debit' then amount_minor else -amount_minor end) <> 0`);
    expect(unbalanced).toHaveLength(0);
    const bal = await db.execute<{ account: string; net: string }>(sql`
      select account, sum(case when direction = 'debit' then amount_minor else -amount_minor end)::text as net
      from ledger_entries group by account order by account`);
    expect(Object.fromEntries(bal.map((b) => [b.account, Number(b.net)]))).toEqual({
      milestone_payable: 0,
      platform_fee_revenue: -12005, // credit balance = revenue (10% of 1200.50)
      provider_balance: 12005,
    });
    expect((await getPublicProfile(db, pub!.slug))!.completedContracts).toBe(1);
    const err = await db.execute(sql`update ledger_entries set amount_minor = 1`).catch((e: { cause?: Error }) => e.cause);
    expect(String(err)).toMatch(/append-only/);
    expect(await db.select().from(ledgerEntries)).toHaveLength(10);
  });
});
