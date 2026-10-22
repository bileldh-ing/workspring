import { AppError } from "@/domain/errors";
import { createTestProvider } from "./test-provider";
import type { PaymentProvider } from "./types";

function unconfigured(id: string, reason: string): PaymentProvider {
  const fail = () => {
    throw new AppError("PROVIDER_UNCONFIGURED", reason);
  };
  return {
    id,
    mode: "live",
    configured: false,
    label: "Payments not configured",
    unavailableReason: reason,
    createPayment: async () => fail(),
    createTransfer: async () => fail(),
    createRefund: async () => fail(),
    verifyWebhook: () => fail(),
  };
}

/**
 * Resolves the configured provider. Only "test" is implemented in R1.
 * Stripe Connect is NOT available to a Tunisia-based platform entity (stripe.com/global, checked 2026-10-21),
 * so no live adapter is wired; any other value yields an explicit unconfigured state (never fake success).
 */
export function getPaymentProvider(): PaymentProvider {
  const name = (process.env.PAYMENTS_PROVIDER ?? "test").toLowerCase();
  if (name === "test") {
    const secret = process.env.TEST_PROVIDER_WEBHOOK_SECRET ?? "";
    if (secret.length < 32) return unconfigured("test", "TEST_PROVIDER_WEBHOOK_SECRET must be set (32+ chars) to use the test provider.");
    return createTestProvider(secret);
  }
  return unconfigured(name, `Payment provider "${name}" is not implemented in this build. Live payments need a provider contract and legal review for the platform's country.`);
}

export type { PaymentProvider, ProviderEvent } from "./types";
