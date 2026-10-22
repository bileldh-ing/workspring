import { AppError } from "./errors";

type Machine<S extends string> = Readonly<Record<S, readonly S[]>>;

export const jobMachine: Machine<"draft" | "open" | "paused" | "closed"> = {
  draft: ["open", "closed"],
  open: ["paused", "closed"],
  paused: ["open", "closed"],
  closed: [],
};

export const proposalMachine: Machine<"submitted" | "shortlisted" | "declined" | "withdrawn" | "offer_sent" | "hired"> = {
  submitted: ["shortlisted", "declined", "withdrawn", "offer_sent"],
  shortlisted: ["submitted", "declined", "withdrawn", "offer_sent"],
  // When an offer is withdrawn/declined/expired the proposal returns to shortlisted.
  offer_sent: ["hired", "shortlisted", "declined", "withdrawn"],
  declined: [],
  withdrawn: [],
  hired: [],
};

export const offerMachine: Machine<"sent" | "accepted" | "declined" | "withdrawn" | "expired"> = {
  sent: ["accepted", "declined", "withdrawn", "expired"],
  accepted: [],
  declined: [],
  withdrawn: [],
  expired: [],
};

export const contractMachine: Machine<"active" | "paused" | "completed" | "canceled"> = {
  active: ["paused", "completed", "canceled"],
  paused: ["active", "canceled"],
  completed: [],
  canceled: [],
};

export type MilestoneStatus =
  | "unfunded"
  | "funding_pending"
  | "funded"
  | "submitted"
  | "revision_requested"
  | "approved"
  | "release_pending"
  | "released"
  | "canceled"
  | "disputed"
  | "refund_pending"
  | "refunded";

export const milestoneMachine: Machine<MilestoneStatus> = {
  unfunded: ["funding_pending", "canceled"],
  // funding_pending -> funded ONLY via verified provider webhook; -> unfunded on provider failure.
  funding_pending: ["funded", "unfunded"],
  funded: ["submitted", "disputed"],
  submitted: ["revision_requested", "approved", "disputed"],
  revision_requested: ["submitted", "disputed"],
  approved: ["release_pending"],
  // release_pending -> released ONLY via verified provider webhook; -> approved on failure (retry).
  release_pending: ["released", "approved"],
  released: [],
  canceled: [],
  // A dispute freezes the milestone. Resolution: back to the prior working state (withdrawn), to approved
  // (release to freelancer) or to refund_pending (refund to client, confirmed only by provider webhook).
  disputed: ["funded", "submitted", "revision_requested", "approved", "refund_pending"],
  refund_pending: ["refunded", "disputed"],
  refunded: [],
};

export const paymentMachine: Machine<"requires_action" | "processing" | "succeeded" | "failed" | "canceled"> = {
  requires_action: ["processing", "succeeded", "failed", "canceled"],
  processing: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  canceled: [],
};

export const invitationMachine: Machine<"sent" | "accepted" | "declined" | "revoked" | "expired"> = {
  sent: ["accepted", "declined", "revoked", "expired"],
  accepted: [],
  declined: [],
  revoked: [],
  expired: [],
};

export const interviewMachine: Machine<"proposed" | "confirmed" | "declined" | "canceled" | "completed"> = {
  proposed: ["confirmed", "declined", "canceled"],
  confirmed: ["canceled", "completed"],
  declined: [],
  canceled: [],
  completed: [],
};

export type TimesheetStatus = "submitted" | "approved" | "disputed" | "payment_pending" | "paid";
export const timesheetMachine: Machine<TimesheetStatus> = {
  submitted: ["approved", "disputed"],
  // A disputed week goes back to submitted once the freelancer corrects entries and resubmits.
  disputed: ["submitted"],
  approved: ["payment_pending"],
  // payment_pending -> paid ONLY via verified provider webhook; -> approved on provider failure (retry).
  payment_pending: ["paid", "approved"],
  paid: [],
};

export type ServiceStatus = "draft" | "pending_review" | "published" | "changes_requested" | "paused" | "archived";
export const serviceMachine: Machine<ServiceStatus> = {
  draft: ["pending_review", "archived"],
  pending_review: ["published", "changes_requested"],
  changes_requested: ["pending_review", "archived"],
  published: ["paused", "archived", "changes_requested"],
  paused: ["published", "archived"],
  archived: [],
};

export type OrderStatus =
  | "pending_payment"
  | "requirements_pending"
  | "in_progress"
  | "delivered"
  | "revision_requested"
  | "release_pending"
  | "completed"
  | "canceled";
export const orderMachine: Machine<OrderStatus> = {
  // pending_payment -> requirements_pending ONLY via verified provider webhook.
  pending_payment: ["requirements_pending", "canceled"],
  requirements_pending: ["in_progress"],
  in_progress: ["delivered"],
  delivered: ["revision_requested", "release_pending"],
  revision_requested: ["delivered"],
  // release_pending -> completed ONLY via verified provider webhook; -> delivered on transfer failure (retry approve).
  release_pending: ["completed", "delivered"],
  completed: [],
  canceled: [],
};

export type DisputeStatus = "open" | "under_review" | "resolved_release" | "resolved_refund" | "withdrawn";
export const disputeMachine: Machine<DisputeStatus> = {
  open: ["under_review", "withdrawn", "resolved_release", "resolved_refund"],
  under_review: ["resolved_release", "resolved_refund", "withdrawn"],
  resolved_release: [],
  resolved_refund: [],
  withdrawn: [],
};

export const ticketMachine: Machine<"open" | "waiting_on_user" | "resolved" | "closed"> = {
  open: ["waiting_on_user", "resolved", "closed"],
  waiting_on_user: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

export function canTransition<S extends string>(m: Machine<S>, from: S, to: S): boolean {
  return (m[from] ?? []).includes(to);
}

export function assertTransition<S extends string>(m: Machine<S>, from: S, to: S, entity = "record"): void {
  if (!canTransition(m, from, to)) {
    throw new AppError("INVALID_TRANSITION", `Cannot move ${entity} from "${from}" to "${to}"`);
  }
}

/** Milestone order rule: milestone N can only be funded once every earlier milestone is at least funded. */
export function canFundInOrder(target: { seq: number }, all: { seq: number; status: MilestoneStatus }[]): boolean {
  return all
    .filter((m) => m.seq < target.seq && m.status !== "canceled")
    .every((m) => !["unfunded", "funding_pending"].includes(m.status));
}
