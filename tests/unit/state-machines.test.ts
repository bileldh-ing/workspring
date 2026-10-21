import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canFundInOrder,
  canTransition,
  contractMachine,
  jobMachine,
  milestoneMachine,
  offerMachine,
  proposalMachine,
} from "@/domain/state-machines";

describe("state machines", () => {
  it("jobs: draft → open → paused → open → closed; closed is terminal", () => {
    expect(canTransition(jobMachine, "draft", "open")).toBe(true);
    expect(canTransition(jobMachine, "open", "paused")).toBe(true);
    expect(canTransition(jobMachine, "paused", "open")).toBe(true);
    expect(canTransition(jobMachine, "open", "draft")).toBe(false);
    expect(jobMachine.closed).toEqual([]);
  });
  it("proposals: withdrawn/declined/hired are terminal", () => {
    for (const s of ["withdrawn", "declined", "hired"] as const) expect(proposalMachine[s]).toEqual([]);
    expect(canTransition(proposalMachine, "submitted", "hired")).toBe(false); // must go through an offer
  });
  it("offers: only a sent offer can be answered", () => {
    expect(canTransition(offerMachine, "sent", "accepted")).toBe(true);
    expect(canTransition(offerMachine, "declined", "accepted")).toBe(false);
    expect(canTransition(offerMachine, "expired", "accepted")).toBe(false);
  });
  it("milestones: funding and release require the provider step", () => {
    expect(canTransition(milestoneMachine, "unfunded", "funded")).toBe(false);
    expect(canTransition(milestoneMachine, "unfunded", "funding_pending")).toBe(true);
    expect(canTransition(milestoneMachine, "unfunded", "submitted")).toBe(false); // no work before funding
    expect(canTransition(milestoneMachine, "approved", "released")).toBe(false);
    expect(canTransition(milestoneMachine, "release_pending", "released")).toBe(true);
    expect(canTransition(milestoneMachine, "revision_requested", "submitted")).toBe(true);
    expect(milestoneMachine.released).toEqual([]);
  });
  it("contracts: completed and canceled are terminal", () => {
    expect(contractMachine.completed).toEqual([]);
    expect(contractMachine.canceled).toEqual([]);
  });
  it("assertTransition throws INVALID_TRANSITION", () => {
    expect(() => assertTransition(jobMachine, "closed", "open", "job")).toThrow(/Cannot move job from "closed" to "open"/);
  });
  it("milestones are funded in order", () => {
    const all = [
      { seq: 1, status: "unfunded" as const },
      { seq: 2, status: "unfunded" as const },
    ];
    expect(canFundInOrder({ seq: 1 }, all)).toBe(true);
    expect(canFundInOrder({ seq: 2 }, all)).toBe(false);
    expect(canFundInOrder({ seq: 2 }, [{ seq: 1, status: "funded" }, { seq: 2, status: "unfunded" }])).toBe(true);
    expect(canFundInOrder({ seq: 2 }, [{ seq: 1, status: "canceled" }, { seq: 2, status: "unfunded" }])).toBe(true);
  });
});
