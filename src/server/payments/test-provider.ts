import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/domain/errors";
import type { PaymentProvider, ProviderEvent } from "./types";

export const TEST_SIGNATURE_HEADER = "x-workspring-test-signature";
const TOLERANCE_SECONDS = 300;

const eventSchema = z.object({
  id: z.string().min(8).max(100),
  type: z.enum(["payment.succeeded", "payment.failed", "transfer.succeeded", "transfer.failed", "refund.succeeded", "refund.failed"]),
  providerRef: z.string().min(4).max(200),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  created: z.number().int().positive(),
  failureReason: z.string().max(300).optional(),
});

export function signPayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** Verifies `t=<unix>,v1=<hex hmac-sha256("<t>.<body>")>` with a 5-minute replay window and constant-time compare. */
export function verifySignature(rawBody: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (!header) throw new AppError("BAD_SIGNATURE", "Missing signature");
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || !/^[0-9a-f]{64}$/.test(parts.v1)) throw new AppError("BAD_SIGNATURE", "Malformed signature");
  if (Math.abs(now - t) > TOLERANCE_SECONDS) throw new AppError("BAD_SIGNATURE", "Signature timestamp outside tolerance");
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "hex");
  const given = Buffer.from(parts.v1, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new AppError("BAD_SIGNATURE", "Signature mismatch");
}

/**
 * TEST MODE provider. No real money moves. It exists so the full asynchronous flow
 * (create → provider outcome → signed webhook → verified, idempotent processing → ledger) runs end to end.
 */
export function createTestProvider(secret: string): PaymentProvider {
  return {
    id: "test",
    mode: "test",
    configured: true,
    label: "TEST MODE: simulated provider, no real money moves",
    async createPayment(input) {
      return { providerRef: `tp_pay_${input.intentId}`, status: "requires_action", actionUrl: `/test-provider/checkout/${input.intentId}` };
    },
    async createTransfer(input) {
      return { providerRef: `tp_tr_${input.intentId}`, status: "processing" };
    },
    async createRefund(input) {
      return { providerRef: `tp_rf_${input.intentId}`, status: "processing" };
    },
    verifyWebhook(rawBody, headers): ProviderEvent {
      verifySignature(rawBody, headers.get(TEST_SIGNATURE_HEADER), secret);
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new AppError("BAD_SIGNATURE", "Body is not JSON");
      }
      const r = eventSchema.safeParse(parsed);
      if (!r.success) throw new AppError("BAD_SIGNATURE", "Unrecognised event shape");
      return r.data;
    },
  };
}
