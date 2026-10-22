"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { AppError } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { runAction, str, strs } from "@/lib/run-action";
import { requireActor } from "@/lib/session";
import * as contracts from "@/server/services/contracts";
import * as jobs from "@/server/services/jobs";
import * as messaging from "@/server/services/messaging";
import { simulateTestProviderOutcome } from "@/server/services/payments";
import * as profiles from "@/server/services/profiles";
import * as proposals from "@/server/services/proposals";
import { filesFrom, storeAttachments } from "@/server/services/files";

const profileFrom = (fd: FormData) => ({
  title: str(fd, "title"),
  overview: str(fd, "overview"),
  hourlyRate: str(fd, "hourlyRate"),
  currency: str(fd, "currency"),
  timezone: str(fd, "timezone"),
  availability: str(fd, "availability"),
  experienceLevel: str(fd, "experienceLevel"),
  categorySlug: str(fd, "categorySlug"),
  skills: strs(fd, "skills"),
});

const jobFrom = (fd: FormData) => ({
  title: str(fd, "title"),
  description: str(fd, "description"),
  categorySlug: str(fd, "categorySlug"),
  skills: strs(fd, "skills"),
  contractType: str(fd, "contractType"),
  currency: str(fd, "currency"),
  budgetMin: str(fd, "budgetMin") || undefined,
  budgetMax: str(fd, "budgetMax"),
  scope: str(fd, "scope"),
  experienceLevel: str(fd, "experienceLevel"),
  locationNote: str(fd, "locationNote") || undefined,
  screeningQuestions: strs(fd, "screeningQuestion").map((q) => q.trim()).filter(Boolean),
});

// ---------- profile
export async function saveProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const r = await profiles.saveProfile(getDb(), await requireActor(), profileFrom(fd));
    revalidatePath("/app/profile");
    return { ok: true, message: r.created ? "Profile saved as a draft. Publish it when you're ready." : "Profile saved." };
  });
}

export async function setProfileVisibilityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const publish = str(fd, "publish") === "1";
    await profiles.setProfileVisibility(getDb(), await requireActor(), publish);
    revalidatePath("/app/profile");
    return { ok: true, message: publish ? "Your profile is public." : "Your profile is hidden from search." };
  });
}

// ---------- jobs
export async function createJobAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const job = await jobs.createJob(getDb(), await requireActor(), jobFrom(fd));
    redirect(`/app/jobs/${job.id}?created=1`);
  });
}

export async function updateJobAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = str(fd, "jobId");
    await jobs.updateJob(getDb(), await requireActor(), id, jobFrom(fd));
    revalidatePath(`/app/jobs/${id}`);
    return { ok: true, message: "Job updated." };
  });
}

export async function transitionJobAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = str(fd, "jobId");
    const to = str(fd, "to");
    if (!["open", "paused", "closed"].includes(to)) throw new AppError("VALIDATION", "Unknown status");
    await jobs.transitionJob(getDb(), await requireActor(), id, to as "open" | "paused" | "closed");
    revalidatePath(`/app/jobs/${id}`);
    // The status buttons change after a transition, which would unmount this form and drop its message,
    // so the confirmation travels in the URL instead.
    redirect(`/app/jobs/${id}?status=${to}`);
  });
}

// ---------- proposals
export async function submitProposalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const p = await proposals.submitProposal(getDb(), await requireActor(), {
      jobId: str(fd, "jobId"),
      coverLetter: str(fd, "coverLetter"),
      amount: str(fd, "amount"),
      durationEstimate: str(fd, "durationEstimate"),
      answers: Object.fromEntries([...fd.entries()].filter(([k, v]) => k.startsWith("answer_") && typeof v === "string").map(([k, v]) => [k.slice(7), v as string])),
    });
    const files = filesFrom(fd);
    if (files.length) await storeAttachments(getDb(), await requireActor(), "proposal", p.id, files);
    redirect(`/app/proposals/${p.id}?submitted=1`);
  });
}

export async function withdrawProposalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = str(fd, "proposalId");
    await proposals.withdrawProposal(getDb(), await requireActor(), id);
    revalidatePath(`/app/proposals/${id}`);
    return { ok: true, message: "Proposal withdrawn." };
  });
}

export async function reviewProposalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = str(fd, "proposalId");
    const op = str(fd, "op");
    if (op !== "shortlist" && op !== "unshortlist" && op !== "decline") throw new AppError("VALIDATION", "Unknown action");
    await proposals.setProposalReview(getDb(), await requireActor(), id, op, { reason: str(fd, "reason") || undefined });
    revalidatePath(`/app/proposals/${id}`);
    return { ok: true, message: "Proposal updated." };
  });
}

// ---------- messaging
export async function openConversationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const conv = await messaging.openProposalConversation(getDb(), await requireActor(), str(fd, "proposalId"));
    redirect(`/app/messages/${conv.id}`);
  });
}

export async function postMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = str(fd, "conversationId");
    await messaging.postMessage(getDb(), await requireActor(), id, { body: str(fd, "body") });
    revalidatePath(`/app/messages/${id}`);
    return { ok: true };
  });
}

// ---------- offers
export async function createOfferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const titles = fd.getAll("msTitle").map(String);
    const amounts = fd.getAll("msAmount").map(String);
    const dues = fd.getAll("msDue").map(String);
    const milestones = titles
      .map((title, i) => ({ title: title.trim(), amount: (amounts[i] ?? "").trim(), dueDate: (dues[i] ?? "").trim() }))
      .filter((m) => m.title || m.amount);
    const hourlyRate = str(fd, "hourlyRate");
    const offer = await contracts.createOffer(
      getDb(),
      await requireActor(),
      hourlyRate
        ? { proposalId: str(fd, "proposalId"), title: str(fd, "title"), description: str(fd, "description"), hourlyRate, weeklyLimitHours: str(fd, "weeklyLimitHours"), allowManualTime: fd.get("allowManualTime") === "on" }
        : { proposalId: str(fd, "proposalId"), title: str(fd, "title"), description: str(fd, "description"), milestones },
    );
    redirect(`/app/offers/${offer.id}?sent=1`);
  });
}

export async function respondOfferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = str(fd, "offerId");
    const op = str(fd, "op");
    const db = getDb();
    const actor = await requireActor();
    if (op === "accept") {
      const c = await contracts.acceptOffer(db, actor, id);
      redirect(`/app/contracts/${c.id}?started=1`);
    }
    if (op === "decline") await contracts.declineOffer(db, actor, id);
    else if (op === "withdraw") await contracts.withdrawOffer(db, actor, id);
    else throw new AppError("VALIDATION", "Unknown action");
    revalidatePath(`/app/offers/${id}`);
    return { ok: true, message: op === "decline" ? "Offer declined." : "Offer withdrawn." };
  });
}

// ---------- milestones
export async function milestoneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = str(fd, "milestoneId");
    const contractId = str(fd, "contractId");
    const op = str(fd, "op");
    const db = getDb();
    const actor = await requireActor();
    switch (op) {
      case "fund": {
        const r = await contracts.fundMilestone(db, actor, id);
        if (r.actionUrl) redirect(r.actionUrl);
        break;
      }
      case "deliver":
        await contracts.deliverMilestone(db, actor, id, { note: str(fd, "note") });
        break;
      case "revision":
        await contracts.requestRevision(db, actor, id, { note: str(fd, "note") });
        break;
      case "approve":
        await contracts.approveMilestone(db, actor, id);
        break;
      case "retry_release":
        await contracts.requestRelease(db, actor, id);
        break;
      default:
        throw new AppError("VALIDATION", "Unknown action");
    }
    revalidatePath(`/app/contracts/${contractId}`);
    return { ok: true, message: "Saved." };
  });
}

export async function simulateProviderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const outcome = str(fd, "outcome") === "failed" ? "failed" : "succeeded";
    const r = await simulateTestProviderOutcome(getDb(), await requireActor(), str(fd, "intentId"), outcome);
    const back = r.back;
    if (/^\/app\/(contracts|orders)\/[0-9a-f-]{36}$/.test(back)) redirect(`${back}?webhook=${r.outcome}`);
    return { ok: true, message: `Webhook processed: ${r.outcome}` };
  });
}
