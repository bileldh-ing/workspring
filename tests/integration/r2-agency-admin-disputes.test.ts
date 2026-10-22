import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, contracts, ledgerEntries, milestones, sessions } from "@/db/schema";
import { auditTrail, grantRole, handleReport, listReports, paymentLog, searchUsers, setUserStatus } from "@/server/services/admin";
import { changeMemberRole, createAgency, getAgencyForMember, getPublicAgency, inviteMember, myAgencyInvitations, removeMember, respondAgencyInvitation, updateAgency } from "@/server/services/agencies";
import { getActorByUserId, login } from "@/server/services/auth";
import { acceptOffer, createOffer, deliverMilestone, fundMilestone } from "@/server/services/contracts";
import { openDispute, resolveDispute, withdrawDispute } from "@/server/services/disputes";
import { simulateTestProviderOutcome } from "@/server/services/payments";
import { fileReport } from "@/server/services/safety";
import { getTicket, openTicket, replyTicket, setTicketStatus, supportQueue } from "@/server/services/support";
import { closeTestDb, hireSetup, makeStaff, makeUser, publishedFreelancer, resetDb, testDb } from "../helpers";

const db = testDb();
beforeAll(() => resetDb(db));
afterAll(() => closeTestDb());

const DESC = "A small synthetic test agency for integration testing purposes.";

describe("agencies", () => {
  it("invite → accept → role limits → removal without leaking or erasing data", async () => {
    const owner = await publishedFreelancer(db, "Owner");
    const m1 = await publishedFreelancer(db, "Member One");
    const m2 = await publishedFreelancer(db, "Member Two");
    const a = await createAgency(db, owner, { name: "Northwind Studio", description: DESC });
    await expect(createAgency(db, owner, { name: "Second Agency", description: DESC })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await inviteMember(db, owner, a.id, "nobody@example.test", "member")).toEqual({ ok: true }); // neutral, no enumeration
    await inviteMember(db, owner, a.id, m1.email, "admin");
    await inviteMember(db, owner, a.id, m2.email, "member");
    const [inv1] = await myAgencyInvitations(db, m1);
    await respondAgencyInvitation(db, m1, inv1.inv.id, true);
    const [inv2] = await myAgencyInvitations(db, m2);
    await expect(respondAgencyInvitation(db, m1, inv2.inv.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await respondAgencyInvitation(db, m2, inv2.inv.id, true);

    await expect(inviteMember(db, m2, a.id, "x@example.test", "member")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(inviteMember(db, m1, a.id, "x@example.test", "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeMember(db, m1, a.id, owner.userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeMemberRole(db, m1, a.id, m2.userId, "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const view = await getAgencyForMember(db, m2, a.id);
    expect(view.members).toHaveLength(3);
    expect(JSON.stringify(view.members)).not.toContain("@"); // no member emails exposed
    expect(view.invites).toHaveLength(0); // members don't see the invitation list

    await removeMember(db, m1, a.id, m2.userId);
    await expect(getAgencyForMember(db, m2, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getActorByUserId(db, m2.userId))?.userId).toBe(m2.userId); // account untouched
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, a.id));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["agency.created", "agency.member_removed"]));

    expect(await getPublicAgency(db, a.slug)).toBeNull();
    await updateAgency(db, owner, a.id, { name: "Northwind Studio", description: DESC }, true);
    expect((await getPublicAgency(db, a.slug))!.members).toHaveLength(2);
  });
});

describe("admin console: role separation and audit", () => {
  it("non-staff get NOT_FOUND; staff need the matching permission; every action is audited", async () => {
    const user = await makeUser(db, "work");
    const target = await makeUser(db, "hire");
    const support = await makeStaff(db, ["support"]);
    const mod = await makeStaff(db, ["moderator"]);
    const fin = await makeStaff(db, ["finance"]);
    const sup = await makeStaff(db, ["superadmin"]);
    await expect(searchUsers(db, user, "")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await searchUsers(db, support, "")).length).toBeGreaterThan(0);
    await expect(setUserStatus(db, support, target.userId, "suspended", "spam")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(paymentLog(db, mod)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await paymentLog(db, fin);
    await expect(grantRole(db, mod, user.userId, "support", true)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await login(db, { email: target.email, password: "correct horse battery staple" });
    await setUserStatus(db, mod, target.userId, "suspended", "Repeated spam reports");
    expect(await db.select().from(sessions).where(eq(sessions.userId, target.userId))).toHaveLength(0);
    await expect(login(db, { email: target.email, password: "correct horse battery staple" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setUserStatus(db, mod, target.userId, "active", "Appeal accepted");
    await expect(setUserStatus(db, mod, sup.userId, "suspended", "Trying to suspend a superadmin")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const r = await fileReport(db, user, { targetType: "user", targetId: target.userId, reason: "harassment" });
    await expect(listReports(db, support)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await handleReport(db, mod, r.id, "actioned", "Warned the member");
    await grantRole(db, sup, user.userId, "support", true);
    const trail = await auditTrail(db, sup);
    expect(trail.map((t) => t.a.action)).toEqual(expect.arrayContaining(["admin.user_suspended", "admin.user_reinstated", "report.actioned", "admin.role_granted"]));
    await expect(auditTrail(db, mod)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("support tickets are private to the owner and support staff; staff actions are audited", async () => {
    const user = await makeUser(db, "work");
    const other = await makeUser(db, "work");
    const support = await makeStaff(db, ["support"]);
    const t = await openTicket(db, user, { subject: "Can't find my invoice", category: "payments", body: "Where do I find invoices for my contract?" });
    await expect(getTicket(db, other, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await supportQueue(db, support)).map((x) => x.t.id)).toContain(t.id);
    await replyTicket(db, support, t.id, "Invoices are planned; the contract ledger shows each payment for now.");
    expect((await getTicket(db, user, t.id)).ticket.status).toBe("waiting_on_user");
    await replyTicket(db, user, t.id, "Thanks, that helps.");
    await setTicketStatus(db, support, t.id, "resolved");
    await setTicketStatus(db, user, t.id, "closed");
    await expect(replyTicket(db, user, t.id, "One more thing")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, t.id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["support.replied", "support.resolved"]));
  });
});

describe("disputes and refunds", () => {
  it("freezes a funded milestone, refunds only on a verified provider webhook, and keeps the ledger balanced", async () => {
    const { client, freelancer, proposal } = await hireSetup(db);
    const offer = await createOffer(db, client, { proposalId: proposal.id, title: "Disputed project", description: "Work that ends up disputed in this test.", milestones: [{ title: "Phase 1", amount: "300" }, { title: "Phase 2", amount: "200" }] });
    const c = await acceptOffer(db, freelancer, offer.id);
    const [m1, m2] = await db.select().from(milestones).where(eq(milestones.contractId, c.id)).orderBy(milestones.seq);
    await expect(openDispute(db, client, { milestoneId: m1.id, reason: "Nothing funded yet, should not be disputable." })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const f1 = await fundMilestone(db, client, m1.id);
    await simulateTestProviderOutcome(db, client, f1.intentId, "succeeded");
    const f2 = await fundMilestone(db, client, m2.id);
    await simulateTestProviderOutcome(db, client, f2.intentId, "succeeded");

    const d0 = await openDispute(db, freelancer, { milestoneId: m2.id, reason: "Client changed the scope after funding." });
    await withdrawDispute(db, freelancer, d0.id);
    expect((await db.select().from(milestones).where(eq(milestones.id, m2.id)))[0].status).toBe("funded");

    await deliverMilestone(db, freelancer, m1.id, { note: "Phase 1 delivered with documentation." });
    const d = await openDispute(db, client, { milestoneId: m1.id, reason: "Delivery does not match the agreed scope at all." });
    await expect(deliverMilestone(db, freelancer, m1.id, { note: "Trying to deliver during a dispute." })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(openDispute(db, freelancer, { milestoneId: m1.id, reason: "Second dispute on the same milestone." })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const support = await makeStaff(db, ["support"]);
    const fin = await makeStaff(db, ["finance"]);
    await expect(resolveDispute(db, support, d.id, "refund", { note: "Refunding the client in full." })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resolveDispute(db, client, d.id, "refund", { note: "Refunding myself, obviously." })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const res = await resolveDispute(db, fin, d.id, "refund", { note: "Evidence shows the delivery was incomplete." });
    expect((await db.select().from(milestones).where(eq(milestones.id, m1.id)))[0].status).toBe("refund_pending");
    await simulateTestProviderOutcome(db, fin, res.intentId!, "succeeded");
    expect((await db.select().from(milestones).where(eq(milestones.id, m1.id)))[0].status).toBe("refunded");
    const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.milestoneId, m1.id));
    const bal = (acct: string) => ledger.filter((l) => l.account === acct).reduce((a, l) => a + (l.direction === "debit" ? l.amountMinor : -l.amountMinor), 0);
    expect(bal("milestone_payable")).toBe(0);
    expect(bal("provider_balance")).toBe(0);
    expect((await db.select().from(contracts).where(eq(contracts.id, c.id)))[0].status).toBe("active"); // m2 still open
  });
});
