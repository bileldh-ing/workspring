import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries, milestones, serviceOrders } from "@/db/schema";
import { createService, getPublicService, listPendingServices, moderateService, ownerTransition, searchServices, updateService } from "@/server/services/catalog";
import { acceptOffer, approveMilestone, createOffer, deliverMilestone, fundMilestone } from "@/server/services/contracts";
import { approveOrder, deliverOrder, getOrder, placeOrder, requestOrderRevision, submitRequirements } from "@/server/services/orders";
import { simulateTestProviderOutcome } from "@/server/services/payments";
import { publicReviewsFor, reviewStateFor, submitReview } from "@/server/services/reviews";
import { closeTestDb, hireSetup, makeStaff, makeUser, publishedFreelancer, resetDb, testDb } from "../helpers";

const db = testDb();
beforeAll(() => resetDb(db));
afterAll(() => closeTestDb());

const tier = (name: string, price: string, days: number, revisions: number) => ({ name, description: `${name} package with clear deliverables`, price, deliveryDays: days, revisions });
const serviceInput = (over: Record<string, unknown> = {}) => ({
  title: "Landing page in Next.js with tests",
  categorySlug: "web-dev",
  summary: "A fast, accessible landing page built with Next.js",
  description: "I will build a responsive, accessible landing page in Next.js with Tailwind, unit tests and a short handover document for your team.",
  currency: "USD",
  maxConcurrentOrders: 2,
  tiers: { starter: tier("Starter", "150", 3, 1), standard: tier("Standard", "300", 5, 2), advanced: tier("Advanced", "600", 10, 3) },
  addons: [{ name: "Copywriting", price: "50", extraDays: 1 }],
  requirements: ["Link to your brand assets", "Target audience"],
  ...over,
});

describe("services catalog", () => {
  it("draft → moderation → published → order → paid by webhook → requirements → deliver → revision → approve → completed", async () => {
    const seller = await publishedFreelancer(db);
    const buyer = await makeUser(db, "hire");
    const mod = await makeStaff(db, ["moderator"]);
    const l = await createService(db, seller, serviceInput());
    await expect(createService(db, seller, serviceInput({ tiers: { starter: tier("S", "300", 3, 1), standard: tier("M", "200", 5, 2), advanced: tier("L", "600", 10, 3) } }))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await getPublicService(db, l.slug)).toBeNull();
    await expect(ownerTransition(db, seller, l.id, "published")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await ownerTransition(db, seller, l.id, "pending_review");
    expect((await listPendingServices(db)).map((x) => x.l.id)).toContain(l.id);
    await expect(moderateService(db, mod.userId, l.id, "request_changes")).rejects.toMatchObject({ code: "VALIDATION" });
    await moderateService(db, mod.userId, l.id, "approve");
    const pub = (await getPublicService(db, l.slug))!;
    expect(pub.tiers.map((t) => t.tier)).toEqual(["starter", "standard", "advanced"]);
    expect((await searchServices(db, { q: "landing page" })).total).toBe(1);

    await expect(placeOrder(db, seller, { listingId: l.id, tier: "starter" })).rejects.toMatchObject({ code: "FORBIDDEN" }); // freelancer-only account
    const { order, intentId } = await placeOrder(db, buyer, { listingId: l.id, tier: "standard", addonIds: [pub.addons[0].id] });
    expect(order.totalMinor).toBe(35000);
    expect(order.deliveryDays).toBe(6);
    await expect(submitRequirements(db, buyer, order.id, { "1": "x" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await simulateTestProviderOutcome(db, buyer, intentId, "succeeded");
    await expect(submitRequirements(db, buyer, order.id, { "1": "https://example.test/brand" })).rejects.toMatchObject({ code: "VALIDATION" });
    await submitRequirements(db, buyer, order.id, { "1": "https://example.test/brand", "2": "Small logistics firms" });
    await deliverOrder(db, seller, order.id, { note: "First version of the landing page is ready." });
    await requestOrderRevision(db, buyer, order.id, { note: "Please make the hero headline larger." });
    await deliverOrder(db, seller, order.id, { note: "Updated the hero headline size as requested." });
    await requestOrderRevision(db, buyer, order.id, { note: "One more tweak to the footer links." });
    await deliverOrder(db, seller, order.id, { note: "Footer links updated and checked on mobile." });
    await expect(requestOrderRevision(db, buyer, order.id, { note: "A third revision beyond the tier." })).rejects.toMatchObject({ code: "CONFLICT" });
    const rel = await approveOrder(db, buyer, order.id);
    expect((await db.select().from(serviceOrders).where(eq(serviceOrders.id, order.id)))[0].status).toBe("release_pending");
    await simulateTestProviderOutcome(db, seller, rel.intentId, "succeeded");
    const view = await getOrder(db, buyer, order.id);
    expect(view.order.status).toBe("completed");
    expect(view.deliveries).toHaveLength(3);
    const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.serviceOrderId, order.id));
    const sum = (d: string) => ledger.filter((x) => x.direction === d).reduce((a, x) => a + x.amountMinor, 0);
    expect(sum("debit")).toBe(sum("credit"));
    const outsider = await makeUser(db, "hire");
    await expect(getOrder(db, outsider, order.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Reviews on a completed order are double-blind
    await submitReview(db, buyer, { kind: "order", id: order.id }, { rating: 5, body: "Clear communication and on time." });
    expect((await publicReviewsFor(db, seller.userId)).count).toBe(0);
    await submitReview(db, seller, { kind: "order", id: order.id }, { rating: 5, body: "Great brief and quick feedback." });
    expect((await publicReviewsFor(db, seller.userId)).average).toBe(5);

    // Editing a published listing sends it back to review
    await updateService(db, seller, l.id, serviceInput({ title: "Landing page in Next.js with tests v2" }));
    expect(await getPublicService(db, l.slug)).toBeNull();
  });

  it("enforces max concurrent orders and never unlocks work without a verified payment", async () => {
    const seller = await publishedFreelancer(db);
    const mod = await makeStaff(db, ["superadmin"]);
    const l = await createService(db, seller, serviceInput({ maxConcurrentOrders: 1 }));
    await ownerTransition(db, seller, l.id, "pending_review");
    await moderateService(db, mod.userId, l.id, "approve");
    const b1 = await makeUser(db, "hire");
    const b2 = await makeUser(db, "hire");
    const o1 = await placeOrder(db, b1, { listingId: l.id, tier: "starter" });
    await simulateTestProviderOutcome(db, b1, o1.intentId, "failed");
    expect((await getOrder(db, b1, o1.order.id)).order.status).toBe("pending_payment");
    await simulateTestProviderOutcome(db, b1, (await placeOrder(db, b1, { listingId: l.id, tier: "starter" })).intentId, "succeeded");
    await expect(placeOrder(db, b2, { listingId: l.id, tier: "starter" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("reviews on contracts", () => {
  it("only parties of completed contracts may review, once each", async () => {
    const { client, freelancer, proposal } = await hireSetup(db);
    const offer = await createOffer(db, client, { proposalId: proposal.id, title: "Small fixed job", description: "One milestone of focused work.", milestones: [{ title: "All work", amount: "100" }] });
    const c = await acceptOffer(db, freelancer, offer.id);
    await expect(submitReview(db, client, { kind: "contract", id: c.id }, { rating: 4, body: "Too early to review this." })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [m] = await db.select().from(milestones).where(eq(milestones.contractId, c.id));
    const f = await fundMilestone(db, client, m.id);
    await simulateTestProviderOutcome(db, client, f.intentId, "succeeded");
    await deliverMilestone(db, freelancer, m.id, { note: "Delivered everything requested." });
    const r = await approveMilestone(db, client, m.id);
    await simulateTestProviderOutcome(db, client, r.intentId, "succeeded");
    const outsider = await makeUser(db, "hire");
    await expect(submitReview(db, outsider, { kind: "contract", id: c.id }, { rating: 1, body: "I was never part of this." })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await submitReview(db, client, { kind: "contract", id: c.id }, { rating: 4, body: "Solid work, would hire again." });
    await expect(submitReview(db, client, { kind: "contract", id: c.id }, { rating: 5, body: "Trying to review twice." })).rejects.toMatchObject({ code: "CONFLICT" });
    const st = await reviewStateFor(db, freelancer, { kind: "contract", id: c.id });
    expect(st.theirsPending).toBe(true);
    expect(st.theirs).toBeNull();
    expect(st.canReview).toBe(true);
  });
});
