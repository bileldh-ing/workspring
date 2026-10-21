import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { milestones } from "@/db/schema";
import type { Actor } from "@/domain/permissions";
import { acceptOffer, approveMilestone, createOffer, deliverMilestone, fundMilestone, getOffer, getWorkroom } from "@/server/services/contracts";
import { createJob, getOwnedJob, transitionJob, updateJob } from "@/server/services/jobs";
import { getConversation, listMessages, openProposalConversation, postMessage } from "@/server/services/messaging";
import { getIntentForParticipant, simulateTestProviderOutcome } from "@/server/services/payments";
import { saveProfile, setProfileVisibility } from "@/server/services/profiles";
import { getProposal, listJobProposals, setProposalReview, submitProposal, withdrawProposal } from "@/server/services/proposals";
import { closeTestDb, jobInput, LONG, makeUser, profileInput, resetDb, testDb } from "../helpers";

const db = testDb();
let client: Actor, freelancer: Actor, otherClient: Actor, otherFreelancer: Actor;
let jobId: string, proposalId: string, conversationId: string, offerId: string, contractId: string, milestoneId: string, intentId: string;

beforeAll(async () => {
  await resetDb(db);
  client = await makeUser(db, "hire");
  otherClient = await makeUser(db, "hire");
  freelancer = await makeUser(db, "work");
  otherFreelancer = await makeUser(db, "work");
  for (const f of [freelancer, otherFreelancer]) {
    await saveProfile(db, f, profileInput());
    await setProfileVisibility(db, f, true);
  }
  jobId = (await createJob(db, client, jobInput())).id;
  await transitionJob(db, client, jobId, "open");
  proposalId = (await submitProposal(db, freelancer, { jobId, coverLetter: LONG("Private cover letter for this client only."), amount: "900", durationEstimate: "1_to_4_weeks" })).id;
  await submitProposal(db, otherFreelancer, { jobId, coverLetter: LONG("Competing private proposal text here."), amount: "800", durationEstimate: "1_to_4_weeks" });
  conversationId = (await openProposalConversation(db, client, proposalId)).id;
  await postMessage(db, client, conversationId, { body: "private hello" });
  offerId = (await createOffer(db, client, { proposalId, title: "Private contract", description: "Scope that only participants may read.", milestones: [{ title: "Only milestone", amount: "900" }] })).id;
  contractId = (await acceptOffer(db, freelancer, offerId)).id;
  milestoneId = (await db.select().from(milestones).where(eq(milestones.contractId, contractId)))[0].id;
  intentId = (await fundMilestone(db, client, milestoneId)).intentId;
});
afterAll(() => closeTestDb());

const NOT_FOUND = { code: "NOT_FOUND" };

describe("cross-user isolation (BOLA/IDOR)", () => {
  it("other freelancers and clients cannot read a private proposal", async () => {
    await expect(getProposal(db, otherFreelancer, proposalId)).rejects.toMatchObject(NOT_FOUND);
    await expect(getProposal(db, otherClient, proposalId)).rejects.toMatchObject(NOT_FOUND);
    await expect(listJobProposals(db, otherClient, jobId)).rejects.toMatchObject(NOT_FOUND);
    await expect(setProposalReview(db, otherClient, proposalId, "decline")).rejects.toMatchObject(NOT_FOUND);
    await expect(withdrawProposal(db, otherFreelancer, proposalId)).rejects.toMatchObject(NOT_FOUND);
    await expect(getProposal(db, freelancer, proposalId)).resolves.toBeTruthy();
  });
  it("a freelancer without client capability cannot list job proposals at all", async () => {
    await expect(listJobProposals(db, freelancer, jobId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("other clients cannot read or edit someone else's job", async () => {
    await expect(getOwnedJob(db, otherClient, jobId)).rejects.toMatchObject(NOT_FOUND);
    await expect(updateJob(db, otherClient, jobId, jobInput())).rejects.toMatchObject(NOT_FOUND);
    await expect(transitionJob(db, otherClient, jobId, "paused")).rejects.toMatchObject(NOT_FOUND);
  });
  it("conversations cannot be read or joined by guessing the id", async () => {
    for (const a of [otherClient, otherFreelancer]) {
      await expect(getConversation(db, a, conversationId)).rejects.toMatchObject(NOT_FOUND);
      await expect(listMessages(db, a, conversationId)).rejects.toMatchObject(NOT_FOUND);
      await expect(postMessage(db, a, conversationId, { body: "let me in" })).rejects.toMatchObject(NOT_FOUND);
    }
    await expect(openProposalConversation(db, otherClient, proposalId)).rejects.toMatchObject(NOT_FOUND);
    await expect(getConversation(db, freelancer, conversationId)).resolves.toBeTruthy();
  });
  it("offers, contracts, milestones and payments are participant-only", async () => {
    for (const a of [otherClient, otherFreelancer]) {
      await expect(getOffer(db, a, offerId)).rejects.toMatchObject(NOT_FOUND);
      await expect(getWorkroom(db, a, contractId)).rejects.toMatchObject(NOT_FOUND);
      await expect(fundMilestone(db, a, milestoneId)).rejects.toMatchObject(NOT_FOUND);
      await expect(deliverMilestone(db, a, milestoneId, { note: "not my contract at all" })).rejects.toMatchObject(NOT_FOUND);
      await expect(getIntentForParticipant(db, a, intentId)).rejects.toMatchObject(NOT_FOUND);
      await expect(simulateTestProviderOutcome(db, a, intentId, "succeeded")).rejects.toMatchObject(NOT_FOUND);
    }
  });
  it("participants can only perform their own side's actions", async () => {
    await expect(fundMilestone(db, freelancer, milestoneId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await simulateTestProviderOutcome(db, client, intentId, "succeeded");
    await expect(deliverMilestone(db, client, milestoneId, { note: "client pretending to deliver" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deliverMilestone(db, freelancer, milestoneId, { note: "Here is the finished deliverable." });
    await expect(approveMilestone(db, freelancer, milestoneId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("unverified accounts cannot publish jobs or send proposals", async () => {
    const unverified = await makeUser(db, "hire", { verified: false });
    const j = await createJob(db, unverified, jobInput());
    await expect(transitionJob(db, unverified, j.id, "open")).rejects.toThrow(/Verify your email/);
  });
});
