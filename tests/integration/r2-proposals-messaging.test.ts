import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailOutbox, notifications } from "@/db/schema";
import { listAttachments, readAttachment, storeAttachments } from "@/server/services/files";
import { getInterview, interviewIcs, joinInterview, respondInterview, scheduleInterview } from "@/server/services/interviews";
import { declineInvitation, inviteToJob, listInvitations, revokeInvitation } from "@/server/services/invitations";
import { screeningQuestionsFor, updateJob } from "@/server/services/jobs";
import { editMessage, getConversation, openProposalConversation, postMessage } from "@/server/services/messaging";
import { listNotifications, markRead, notify, setPreferences, unreadCount } from "@/server/services/notifications";
import { getProposal, submitProposal } from "@/server/services/proposals";
import { blockUser, fileReport, unblockUser } from "@/server/services/safety";
import { setStorageForTests, signDownload, verifyDownload } from "@/server/storage";
import { createLocalStorage } from "@/server/storage/local";
import { closeTestDb, hireSetup, jobInput, LONG, makeUser, openJob, publishedFreelancer, resetDb, testDb } from "../helpers";

const db = testDb();
const NOT_FOUND = { code: "NOT_FOUND" };
let tmp: string;
beforeAll(async () => {
  await resetDb(db);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-files-"));
  setStorageForTests(createLocalStorage(tmp));
});
afterAll(async () => {
  setStorageForTests(null);
  fs.rmSync(tmp, { recursive: true, force: true });
  await closeTestDb();
});

const pdf = (name = "brief.pdf") => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10, 37, 37, 69, 79, 70])], name, { type: "application/pdf" });

describe("screening questions and invitations", () => {
  it("requires answers to screening questions and snapshots them on the proposal", async () => {
    const client = await makeUser(db, "hire");
    const f = await publishedFreelancer(db);
    const job = await openJob(db, client, { screeningQuestions: ["Which similar dashboards have you built?", "When can you start?"] });
    const qs = await screeningQuestionsFor(db, job.id);
    expect(qs).toHaveLength(2);
    const base = { jobId: job.id, coverLetter: LONG("I have built several of these dashboards."), amount: "900", durationEstimate: "1_to_4_weeks" };
    await expect(submitProposal(db, f, { ...base, answers: { [qs[0].id]: "Three" } })).rejects.toMatchObject({ code: "VALIDATION" });
    const p = await submitProposal(db, f, { ...base, answers: { [qs[0].id]: "Three for logistics clients", [qs[1].id]: "Monday" } });
    const view = await getProposal(db, client, p.id);
    expect(view.answers.map((a) => a.prompt)).toEqual(expect.arrayContaining(["When can you start?"]));
    await expect(updateJob(db, client, job.id, jobInput({ screeningQuestions: ["A brand new question?"] }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("invites a freelancer, prevents duplicates, and marks the invitation accepted when they apply", async () => {
    const client = await makeUser(db, "hire");
    const f = await publishedFreelancer(db);
    const job = await openJob(db, client);
    const inv = await inviteToJob(db, client, { jobId: job.id, freelancerId: f.userId, message: "Your profile fits this project well." });
    await expect(inviteToJob(db, client, { jobId: job.id, freelancerId: f.userId, message: "Second invitation for the same job" })).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await makeUser(db, "hire");
    await expect(inviteToJob(db, other, { jobId: job.id, freelancerId: f.userId, message: "Not my job but let me try" })).rejects.toMatchObject(NOT_FOUND);
    await expect(declineInvitation(db, other, inv.id)).rejects.toMatchObject(NOT_FOUND);
    expect((await listInvitations(db, f))[0].effectiveStatus).toBe("sent");
    await submitProposal(db, f, { jobId: job.id, coverLetter: LONG("Thanks for the invitation, here is my plan."), amount: "1000", durationEstimate: "1_to_4_weeks" });
    expect((await listInvitations(db, f))[0].effectiveStatus).toBe("accepted");
    expect((await listNotifications(db, f)).some((n) => n.kind === "invitation.received")).toBe(true);
  });

  it("supports decline and revoke with state-machine checks", async () => {
    const client = await makeUser(db, "hire");
    const f = await publishedFreelancer(db);
    const job = await openJob(db, client);
    const a = await inviteToJob(db, client, { jobId: job.id, freelancerId: f.userId, message: "Would you like to apply here?" });
    await declineInvitation(db, f, a.id, "Fully booked");
    await expect(revokeInvitation(db, client, a.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const b = await inviteToJob(db, client, { jobId: job.id, freelancerId: f.userId, message: "Trying again next month maybe?" });
    await revokeInvitation(db, client, b.id);
  });
});

describe("notifications", () => {
  it("are created once per event, counted, marked read, and respect preferences except mandatory ones", async () => {
    const { client, freelancer, proposal } = await hireSetup(db);
    const before = await unreadCount(db, client.userId);
    expect(before).toBeGreaterThanOrEqual(1);
    await notify(db, { userId: client.userId, category: "proposals", kind: "proposal.received", title: "dup", dedupeKey: `proposal.received:${proposal.id}` });
    expect(await unreadCount(db, client.userId)).toBe(before);
    await markRead(db, client);
    expect(await unreadCount(db, client.userId)).toBe(0);
    await setPreferences(db, freelancer, [{ category: "messages", email: false, inApp: false }, { category: "payments", email: false, inApp: false }]);
    await notify(db, { userId: freelancer.userId, category: "messages", kind: "x", title: "muted", dedupeKey: "muted-1" });
    await notify(db, { userId: freelancer.userId, category: "payments", kind: "y", title: "mandatory", dedupeKey: "mandatory-1" });
    const rows = await db.select().from(notifications).where(eq(notifications.userId, freelancer.userId));
    expect(rows.map((r) => r.title)).toContain("mandatory");
    expect(rows.map((r) => r.title)).not.toContain("muted");
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.template, "notify.x"))).toHaveLength(0);
  });
});

describe("blocking, reporting and messaging controls", () => {
  it("blocks messaging and applying in both directions; edits are marked; reports are deduplicated", async () => {
    const { client, freelancer, proposal } = await hireSetup(db);
    const conv = await openProposalConversation(db, client, proposal.id);
    const m = await postMessage(db, freelancer, conv.id, { body: "Hello there" });
    await blockUser(db, freelancer, client.userId);
    await expect(postMessage(db, client, conv.id, { body: "Are you there?" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(postMessage(db, freelancer, conv.id, { body: "Me neither" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getConversation(db, client, conv.id)).blocked).toBe(true);
    const job2 = await openJob(db, client);
    await expect(submitProposal(db, freelancer, { jobId: job2.id, coverLetter: LONG("Applying although I blocked this client."), amount: "900", durationEstimate: "1_to_4_weeks" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await unblockUser(db, freelancer, client.userId);
    await editMessage(db, freelancer, m.id, "edit", { body: "Hello there (edited)" });
    expect((await getConversation(db, freelancer, conv.id)).messages[0].editedAt).not.toBeNull();
    await editMessage(db, freelancer, m.id, "delete");
    expect((await getConversation(db, client, conv.id)).messages[0].body).toBe("");
    await expect(editMessage(db, client, m.id, "delete")).rejects.toMatchObject({ code: "FORBIDDEN" });

    await fileReport(db, client, { targetType: "user", targetId: freelancer.userId, reason: "spam", details: "Unsolicited links" });
    await expect(fileReport(db, client, { targetType: "user", targetId: freelancer.userId, reason: "spam" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(fileReport(db, client, { targetType: "user", targetId: client.userId, reason: "spam" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("private attachments", () => {
  it("stores allowlisted files, signs short-lived user-bound URLs, and denies non-participants", async () => {
    const { client, freelancer, proposal } = await hireSetup(db);
    const stored = await storeAttachments(db, freelancer, "proposal", proposal.id, [pdf()]);
    expect(stored[0].mimeType).toBe("application/pdf");
    await expect(storeAttachments(db, freelancer, "proposal", proposal.id, [new File(["MZ binary"], "evil.exe")])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(storeAttachments(db, freelancer, "proposal", proposal.id, [new File(["not a pdf at all"], "fake.pdf")])).rejects.toMatchObject({ code: "VALIDATION" });
    const outsider = await makeUser(db, "work");
    await expect(storeAttachments(db, outsider, "proposal", proposal.id, [pdf()])).rejects.toMatchObject(NOT_FOUND);

    const forClient = await listAttachments(db, client, "proposal", [proposal.id]);
    expect(forClient).toHaveLength(1);
    expect(await listAttachments(db, outsider, "proposal", [proposal.id])).toHaveLength(0);
    const url = new URL(forClient[0].url, "http://x");
    expect(verifyDownload(stored[0].id, client.userId, url.searchParams.get("exp"), url.searchParams.get("sig"))).toBe(true);
    expect(verifyDownload(stored[0].id, outsider.userId, url.searchParams.get("exp"), url.searchParams.get("sig"))).toBe(false);
    const old = new URL(signDownload(stored[0].id, client.userId, Math.floor(Date.now() / 1000) - 3600), "http://x");
    expect(verifyDownload(stored[0].id, client.userId, old.searchParams.get("exp"), old.searchParams.get("sig"))).toBe(false);
    const { bytes } = await readAttachment(db, client.userId, stored[0].id);
    expect(bytes[0]).toBe(0x25);
    await expect(readAttachment(db, outsider.userId, stored[0].id)).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("interviews", () => {
  it("schedules, confirms, issues ICS, and gates video on LiveKit configuration", async () => {
    const { client, freelancer, proposal } = await hireSetup(db);
    const startsAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    await expect(scheduleInterview(db, freelancer, { proposalId: proposal.id, startsAt, durationMinutes: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(scheduleInterview(db, client, { proposalId: proposal.id, startsAt: new Date(Date.now() - 1000).toISOString(), durationMinutes: 30 })).rejects.toMatchObject({ code: "VALIDATION" });
    const iv = await scheduleInterview(db, client, { proposalId: proposal.id, startsAt, durationMinutes: 30, agenda: "Walk through the plan" });
    await expect(respondInterview(db, client, iv.id, "confirmed")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await respondInterview(db, freelancer, iv.id, "confirmed");
    const outsider = await makeUser(db, "work");
    await expect(getInterview(db, outsider, iv.id)).rejects.toMatchObject(NOT_FOUND);
    expect(interviewIcs(await getInterview(db, client, iv.id), "Test")).toContain("STATUS:CONFIRMED");

    delete process.env.LIVEKIT_URL;
    await expect(joinInterview(db, client, iv.id)).rejects.toMatchObject({ code: "PROVIDER_UNCONFIGURED" });
    process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "APIkey123";
    process.env.LIVEKIT_API_SECRET = "secret-for-tests-0123456789abcdef";
    try {
      await expect(joinInterview(db, client, iv.id)).rejects.toMatchObject({ code: "CONFLICT" }); // too early
      const tok = await joinInterview(db, freelancer, iv.id, new Date(Date.parse(startsAt) - 5 * 60_000));
      const payload = JSON.parse(Buffer.from(tok.token.split(".")[1], "base64url").toString());
      expect(payload.sub).toBe(freelancer.userId);
      expect(payload.video).toMatchObject({ room: iv.roomName, roomJoin: true, roomAdmin: false });
      await expect(joinInterview(db, outsider, iv.id)).rejects.toMatchObject(NOT_FOUND);
    } finally {
      delete process.env.LIVEKIT_URL;
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;
    }
  });
});
