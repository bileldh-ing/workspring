import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reviewsForModeration, rolesForUsers } from "@/server/services/admin";
import { createService, moderateService, ownerTransition, publishedServicesBy } from "@/server/services/catalog";
import { closeTestDb, makeStaff, makeUser, publishedFreelancer, resetDb, testDb } from "../helpers";

const db = testDb();
beforeAll(() => resetDb(db));
afterAll(() => closeTestDb());

const tier = (name: string, price: string) => ({ name, description: `${name} package with clear deliverables`, price, deliveryDays: 3, revisions: 1 });

describe("console and profile read models", () => {
  it("publishedServicesBy lists only published listings with their starter tier", async () => {
    const seller = await publishedFreelancer(db);
    const mod = await makeStaff(db, ["moderator"]);
    const input = { title: "Accessible landing page build", categorySlug: "web-dev", summary: "A fast and accessible landing page for small teams", description: "I will build an accessible landing page with tests, documentation and a short handover call for your team.", currency: "USD", tiers: { starter: tier("S", "100"), standard: tier("M", "200"), advanced: tier("L", "300") } };
    const draft = await createService(db, seller, input);
    const pub = await createService(db, seller, { ...input, title: "Accessible landing page build v2" });
    await ownerTransition(db, seller, pub.id, "pending_review");
    await moderateService(db, mod.userId, pub.id, "approve");
    const rows = await publishedServicesBy(db, seller.userId);
    expect(rows.map((r) => r.id)).toEqual([pub.id]);
    expect(rows[0].starter?.priceMinor).toBe(10000);
    expect(rows.map((r) => r.id)).not.toContain(draft.id);
  });

  it("staff read models enforce permissions (NOT_FOUND for non-staff, FORBIDDEN without the permission)", async () => {
    const user = await makeUser(db, "hire");
    const support = await makeStaff(db, ["support"]);
    const mod = await makeStaff(db, ["moderator"]);
    await expect(reviewsForModeration(db, user)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reviewsForModeration(db, support)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(Array.isArray(await reviewsForModeration(db, mod))).toBe(true);
    await expect(rolesForUsers(db, user, [mod.userId])).rejects.toMatchObject({ code: "NOT_FOUND" });
    const roles = await rolesForUsers(db, support, [mod.userId, user.userId]);
    expect(roles).toEqual([{ userId: mod.userId, role: "moderator" }]);
  });
});
