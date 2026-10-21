import { AppError } from "./errors";

export type Capability = "client" | "freelancer" | "admin";
export type Mode = "client" | "freelancer";

export interface Actor {
  userId: string;
  email: string;
  displayName: string;
  capabilities: Capability[];
  activeMode: Mode;
  emailVerified: boolean;
}

export const hasCapability = (a: Actor, c: Capability) => a.capabilities.includes(c);

export function requireCapability(a: Actor | null | undefined, c: Capability): asserts a is Actor {
  if (!a) throw new AppError("UNAUTHENTICATED", "Please sign in");
  if (!hasCapability(a, c)) {
    throw new AppError("FORBIDDEN", c === "client" ? "Add the client capability to hire" : `Requires the ${c} capability`);
  }
}

export function requireVerifiedEmail(a: Actor) {
  if (!a.emailVerified) throw new AppError("FORBIDDEN", "Verify your email address before doing this");
}

/** Who may read a proposal: its author or the client who owns the job. Everyone else gets NOT_FOUND. */
export function canReadProposal(a: Actor, p: { freelancerId: string }, job: { clientId: string }) {
  return a.userId === p.freelancerId || a.userId === job.clientId;
}

/** Contract participants: exactly the client and the freelancer on the contract. */
export function contractRole(a: Actor, c: { clientId: string; freelancerId: string }): "client" | "freelancer" | null {
  if (a.userId === c.clientId) return "client";
  if (a.userId === c.freelancerId) return "freelancer";
  return null;
}

/** Self-dealing guard: nobody may apply to, hire on, or contract with their own job. */
export function assertNotSelf(a: string, b: string, message = "You cannot do this on your own job") {
  if (a === b) throw new AppError("FORBIDDEN", message);
}
