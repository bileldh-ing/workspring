import { describe, expect, it } from "vitest";
import { type Actor, assertNotSelf, canReadProposal, contractRole, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import { CONTACT_RE } from "@/domain/validation";

const actor = (over: Partial<Actor> = {}): Actor => ({
  userId: "u1",
  email: "a@example.test",
  displayName: "A",
  capabilities: ["freelancer"],
  activeMode: "freelancer",
  emailVerified: true,
  ...over,
});

describe("permissions", () => {
  it("requires sign-in and capability", () => {
    expect(() => requireCapability(null, "client")).toThrow(/sign in/);
    expect(() => requireCapability(actor(), "client")).toThrow(/client capability/);
    expect(() => requireCapability(actor({ capabilities: ["client", "freelancer"] }), "client")).not.toThrow();
  });
  it("requires a verified email for gated actions", () => {
    expect(() => requireVerifiedEmail(actor({ emailVerified: false }))).toThrow(/Verify/);
  });
  it("proposal readable only by author or job owner", () => {
    expect(canReadProposal(actor({ userId: "f" }), { freelancerId: "f" }, { clientId: "c" })).toBe(true);
    expect(canReadProposal(actor({ userId: "c" }), { freelancerId: "f" }, { clientId: "c" })).toBe(true);
    expect(canReadProposal(actor({ userId: "x" }), { freelancerId: "f" }, { clientId: "c" })).toBe(false);
  });
  it("contract roles", () => {
    const c = { clientId: "c", freelancerId: "f" };
    expect(contractRole(actor({ userId: "c" }), c)).toBe("client");
    expect(contractRole(actor({ userId: "f" }), c)).toBe("freelancer");
    expect(contractRole(actor({ userId: "x" }), c)).toBeNull();
  });
  it("self-dealing guard", () => expect(() => assertNotSelf("a", "a")).toThrow());
  it("contact-detail heuristic for job posts", () => {
    expect(CONTACT_RE.test("mail me at bob@example.com")).toBe(true);
    expect(CONTACT_RE.test("call +216 94 000 000")).toBe(true);
    expect(CONTACT_RE.test("Budget is 1500 USD for 3 pages")).toBe(false);
  });
});
