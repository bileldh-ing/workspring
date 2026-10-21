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
  | "canceled";

export const milestoneMachine: Machine<MilestoneStatus> = {
  unfunded: ["funding_pending", "canceled"],
  // funding_pending -> funded ONLY via verified provider webhook; -> unfunded on provider failure.
  funding_pending: ["funded", "unfunded"],
  funded: ["submitted"],
  submitted: ["revision_requested", "approved"],
  revision_requested: ["submitted"],
  approved: ["release_pending"],
  // release_pending -> released ONLY via verified provider webhook; -> approved on failure (retry).
  release_pending: ["released", "approved"],
  released: [],
  canceled: [],
};

export const paymentMachine: Machine<"requires_action" | "processing" | "succeeded" | "failed" | "canceled"> = {
  requires_action: ["processing", "succeeded", "failed", "canceled"],
  processing: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  canceled: [],
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
