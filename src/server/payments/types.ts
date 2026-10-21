/** Provider-neutral payment interfaces. Live providers must implement these; R1 ships a TEST MODE provider only. */
export type ProviderEventType = "payment.succeeded" | "payment.failed" | "transfer.succeeded" | "transfer.failed";

export interface ProviderEvent {
  id: string; // provider's unique event id (dedupe key)
  type: ProviderEventType;
  providerRef: string; // provider's id for the payment/transfer object
  amountMinor: number;
  currency: string;
  created: number; // unix seconds
  failureReason?: string;
}

export interface CreateMoneyMovement {
  intentId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  description: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly mode: "test" | "live";
  readonly configured: boolean;
  /** Human label shown in the UI next to every payment state. */
  readonly label: string;
  /** Explains why the provider is unavailable when configured=false. */
  readonly unavailableReason?: string;
  /** Collect funds from the client (checkout). Never treat the return value as success. */
  createPayment(input: CreateMoneyMovement): Promise<{ providerRef: string; status: "requires_action" | "processing"; actionUrl?: string }>;
  /** Move funds to the freelancer (transfer/payout). Outcome arrives by webhook. */
  createTransfer(input: CreateMoneyMovement): Promise<{ providerRef: string; status: "processing" }>;
  /** Verifies the signature and parses the event. Must throw AppError("BAD_SIGNATURE") on any failure. */
  verifyWebhook(rawBody: string, headers: Headers): ProviderEvent;
}
