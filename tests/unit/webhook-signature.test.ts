import { describe, expect, it } from "vitest";
import { createTestProvider, signPayload, TEST_SIGNATURE_HEADER, verifySignature } from "@/server/payments/test-provider";

const secret = "unit-test-secret-0123456789abcdef0123";
const body = JSON.stringify({ id: "evt_12345678", type: "payment.succeeded", providerRef: "tp_pay_x", amountMinor: 100, currency: "USD", created: 1 });

describe("test provider webhook signatures", () => {
  it("accepts a valid signature", () => {
    expect(() => verifySignature(body, signPayload(body, secret), secret)).not.toThrow();
  });
  it("rejects a tampered body", () => {
    const sig = signPayload(body, secret);
    expect(() => verifySignature(body.replace("100", "999"), sig, secret)).toThrow(/mismatch/);
  });
  it("rejects a wrong secret", () => {
    expect(() => verifySignature(body, signPayload(body, "another-secret-entirely-0123456789"), secret)).toThrow(/mismatch/);
  });
  it("rejects stale timestamps (replay window)", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => verifySignature(body, signPayload(body, secret, old), secret)).toThrow(/tolerance/);
  });
  it("rejects missing/malformed headers", () => {
    expect(() => verifySignature(body, null, secret)).toThrow(/Missing/);
    expect(() => verifySignature(body, "t=abc,v1=zz", secret)).toThrow(/Malformed/);
  });
  it("provider parses only well-formed, signed events", () => {
    const p = createTestProvider(secret);
    const ok = p.verifyWebhook(body, new Headers({ [TEST_SIGNATURE_HEADER]: signPayload(body, secret) }));
    expect(ok.type).toBe("payment.succeeded");
    const junk = JSON.stringify({ hello: "world" });
    expect(() => p.verifyWebhook(junk, new Headers({ [TEST_SIGNATURE_HEADER]: signPayload(junk, secret) }))).toThrow(/Unrecognised/);
  });
  it("test provider never reports immediate success", async () => {
    const p = createTestProvider(secret);
    const r = await p.createPayment({ intentId: "i1", amountMinor: 100, currency: "USD", idempotencyKey: "k", description: "d" });
    expect(r.status).toBe("requires_action");
  });
});
