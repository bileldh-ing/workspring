"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { AppError } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { runAction, str, strs } from "@/lib/run-action";
import { requireActor } from "@/lib/session";
import * as admin from "@/server/services/admin";
import * as agencies from "@/server/services/agencies";
import * as catalog from "@/server/services/catalog";
import * as disputes from "@/server/services/disputes";
import { filesFrom, storeAttachments } from "@/server/services/files";
import * as hourly from "@/server/services/hourly";
import * as interviews from "@/server/services/interviews";
import * as invitations from "@/server/services/invitations";
import * as messaging from "@/server/services/messaging";
import * as notifications from "@/server/services/notifications";
import * as orders from "@/server/services/orders";
import { simulateTestProviderOutcome } from "@/server/services/payments";
import * as reviews from "@/server/services/reviews";
import * as safety from "@/server/services/safety";
import * as support from "@/server/services/support";
import { enforceRateLimit } from "@/server/rate-limit";

const UUID = /^[0-9a-f-]{36}$/i;
const id = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!UUID.test(v)) throw new AppError("VALIDATION", "Invalid reference");
  return v;
};

// ---------- notifications & settings
export async function markNotificationsReadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const nid = str(fd, "notificationId");
    await notifications.markRead(getDb(), await requireActor(), UUID.test(nid) ? nid : undefined);
    revalidatePath("/app/notifications");
    return { ok: true, message: "Marked as read." };
  });
}

export async function savePreferencesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const prefs = Object.keys(notifications.NOTIFICATION_CATEGORIES).map((c) => ({ category: c, email: fd.get(`email_${c}`) === "on", inApp: fd.get(`inapp_${c}`) === "on" }));
    await notifications.setPreferences(getDb(), await requireActor(), prefs);
    revalidatePath("/app/settings");
    return { ok: true, message: "Notification preferences saved." };
  });
}

// ---------- safety
export async function blockAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const target = id(fd, "userId");
    if (str(fd, "op") === "unblock") await safety.unblockUser(getDb(), actor, target);
    else await safety.blockUser(getDb(), actor, target);
    const back = str(fd, "back");
    if (back.startsWith("/app/") || back.startsWith("/freelancers/")) revalidatePath(back);
    revalidatePath("/app/settings");
    return { ok: true, message: str(fd, "op") === "unblock" ? "Member unblocked." : "Member blocked. They can't message you, apply to your jobs or send you offers." };
  });
}

export async function reportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await enforceRateLimit(getDb(), "report", actor.userId);
    await safety.fileReport(getDb(), actor, { targetType: str(fd, "targetType"), targetId: str(fd, "targetId"), reason: str(fd, "reason"), details: str(fd, "details") || undefined });
    return { ok: true, message: "Report sent. Our trust & safety team will review it. Details are only visible to authorized staff." };
  });
}

// ---------- invitations
export async function inviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await invitations.inviteToJob(getDb(), await requireActor(), { jobId: str(fd, "jobId"), freelancerId: str(fd, "freelancerId"), message: str(fd, "message") });
    return { ok: true, message: "Invitation sent." };
  });
}

export async function invitationResponseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const inv = id(fd, "invitationId");
    const op = str(fd, "op");
    if (op === "decline") await invitations.declineInvitation(getDb(), actor, inv, str(fd, "reason") || undefined);
    else if (op === "revoke") await invitations.revokeInvitation(getDb(), actor, inv);
    else throw new AppError("VALIDATION", "Unknown action");
    revalidatePath("/app/invitations");
    if (UUID.test(str(fd, "jobId"))) revalidatePath(`/app/jobs/${str(fd, "jobId")}`);
    return { ok: true, message: op === "decline" ? "Invitation declined." : "Invitation revoked." };
  });
}

// ---------- attachments & messages
export async function uploadAttachmentsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await enforceRateLimit(getDb(), "upload", actor.userId);
    const type = str(fd, "entityType") as "proposal" | "milestone_submission" | "order_delivery" | "support_ticket" | "dispute";
    if (!["proposal", "milestone_submission", "order_delivery", "support_ticket", "dispute"].includes(type)) throw new AppError("VALIDATION", "Unknown attachment target");
    const files = filesFrom(fd);
    if (files.length === 0) throw new AppError("VALIDATION", "Choose at least one file", { files: "Required" });
    await storeAttachments(getDb(), actor, type, id(fd, "entityId"), files);
    const back = str(fd, "back");
    if (back.startsWith("/app/")) revalidatePath(back);
    return { ok: true, message: `${files.length} file(s) attached.` };
  });
}

export async function postMessageWithFilesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const conv = id(fd, "conversationId");
    const files = filesFrom(fd);
    const body = str(fd, "body") || (files.length ? "(attachment)" : "");
    const db = getDb();
    if (files.length) await enforceRateLimit(db, "upload", actor.userId);
    const m = await messaging.postMessage(db, actor, conv, { body });
    if (files.length) await storeAttachments(db, actor, "message", m.id, files);
    revalidatePath(`/app/messages/${conv}`);
    return { ok: true };
  });
}

export async function editMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const op = str(fd, "op") === "delete" ? "delete" : "edit";
    const convId = await messaging.editMessage(getDb(), await requireActor(), id(fd, "messageId"), op, { body: str(fd, "body") });
    revalidatePath(`/app/messages/${convId}`);
    return { ok: true, message: op === "delete" ? "Message deleted." : "Message edited." };
  });
}

// ---------- interviews
export async function scheduleInterviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    // datetime-local has no zone: the form sends the browser's UTC offset (minutes) so we store true UTC.
    const local = str(fd, "startsAtLocal");
    const offset = Number(str(fd, "tzOffset") || "0");
    const startsAt = local ? new Date(new Date(`${local}:00Z`).getTime() + offset * 60_000).toISOString() : "";
    await interviews.scheduleInterview(getDb(), await requireActor(), { proposalId: str(fd, "proposalId"), startsAt, durationMinutes: str(fd, "durationMinutes"), agenda: str(fd, "agenda") || undefined });
    redirect("/app/interviews?scheduled=1");
  });
}

export async function interviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const to = str(fd, "to") as "confirmed" | "declined" | "canceled" | "completed";
    if (!["confirmed", "declined", "canceled", "completed"].includes(to)) throw new AppError("VALIDATION", "Unknown action");
    await interviews.respondInterview(getDb(), await requireActor(), id(fd, "interviewId"), to, str(fd, "note") || undefined);
    revalidatePath("/app/interviews");
    return { ok: true, message: `Interview ${to}.` };
  });
}

export async function joinInterviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const r = await interviews.joinInterview(getDb(), await requireActor(), id(fd, "interviewId"));
    // The token is shown once to the participant; it is short-lived and scoped to this room only.
    return { ok: true, message: `Room ready: ${r.room}. Open ${r.url} with your LiveKit client using the issued token (valid until the interview ends).` };
  });
}

// ---------- hourly
export async function hourlyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const db = getDb();
    const contractId = id(fd, "contractId");
    const op = str(fd, "op");
    let message = "Saved.";
    switch (op) {
      case "start":
        await hourly.startTimer(db, actor, contractId, { memo: str(fd, "memo") });
        message = "Timer started.";
        break;
      case "stop": {
        const r = await hourly.stopTimer(db, actor, contractId, { memo: str(fd, "memo") });
        message = r.trimmed ? `Timer stopped: ${r.minutes} min recorded (trimmed to the weekly limit).` : `Timer stopped: ${r.minutes} min recorded.`;
        break;
      }
      case "manual":
        await hourly.addManualEntry(db, actor, { contractId, date: str(fd, "date"), minutes: str(fd, "minutes"), memo: str(fd, "memo") });
        message = "Manual entry added.";
        break;
      case "delete_entry":
        await hourly.changeEntry(db, actor, id(fd, "entryId"), "delete");
        message = "Entry deleted.";
        break;
      case "memo":
        await hourly.changeEntry(db, actor, id(fd, "entryId"), "memo", { memo: str(fd, "memo") });
        message = "Memo updated.";
        break;
      case "submit_week":
        await hourly.submitTimesheet(db, actor, contractId, str(fd, "weekStart"));
        message = "Timesheet submitted for review.";
        break;
      case "dispute_week":
        await hourly.disputeTimesheet(db, actor, id(fd, "timesheetId"), str(fd, "reason"));
        message = "Timesheet disputed. The freelancer can correct entries and resubmit.";
        break;
      case "approve_week": {
        const r = await hourly.approveTimesheet(db, actor, id(fd, "timesheetId"));
        if (r.actionUrl) redirect(r.actionUrl);
        message = "Approved. Payment requested from the provider.";
        break;
      }
      case "end":
        await hourly.endHourlyContract(db, actor, contractId);
        message = "Contract ended.";
        break;
      default:
        throw new AppError("VALIDATION", "Unknown action");
    }
    revalidatePath(`/app/contracts/${contractId}`);
    return { ok: true, message };
  });
}

// ---------- disputes & reviews
export async function disputeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const contractId = id(fd, "contractId");
    if (str(fd, "op") === "withdraw") await disputes.withdrawDispute(getDb(), actor, id(fd, "disputeId"));
    else await disputes.openDispute(getDb(), actor, { milestoneId: str(fd, "milestoneId"), reason: str(fd, "reason") });
    revalidatePath(`/app/contracts/${contractId}`);
    return { ok: true, message: str(fd, "op") === "withdraw" ? "Dispute withdrawn." : "Dispute opened. The milestone is on hold until support reviews it." };
  });
}

export async function reviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const kind = str(fd, "kind") === "order" ? "order" : "contract";
    const target = id(fd, "targetId");
    await reviews.submitReview(getDb(), await requireActor(), { kind, id: target }, { rating: str(fd, "rating"), body: str(fd, "body") });
    revalidatePath(kind === "order" ? `/app/orders/${target}` : `/app/contracts/${target}`);
    return { ok: true, message: "Review submitted. It becomes visible when the other party reviews too, or when the 14-day window closes." };
  });
}

// ---------- services catalog
function serviceFrom(fd: FormData) {
  const t = (k: string) => ({ name: str(fd, `${k}_name`), description: str(fd, `${k}_description`), price: str(fd, `${k}_price`), deliveryDays: str(fd, `${k}_days`), revisions: str(fd, `${k}_revisions`) });
  const addonNames = fd.getAll("addon_name").map(String);
  const addonPrices = fd.getAll("addon_price").map(String);
  const addonDays = fd.getAll("addon_days").map(String);
  return {
    title: str(fd, "title"),
    categorySlug: str(fd, "categorySlug"),
    summary: str(fd, "summary"),
    description: str(fd, "description"),
    currency: str(fd, "currency"),
    maxConcurrentOrders: str(fd, "maxConcurrentOrders") || "3",
    tiers: { starter: t("starter"), standard: t("standard"), advanced: t("advanced") },
    addons: addonNames.map((name, i) => ({ name: name.trim(), price: addonPrices[i] ?? "", extraDays: addonDays[i] || "0" })).filter((a) => a.name),
    requirements: strs(fd, "requirement").map((r) => r.trim()).filter(Boolean),
  };
}

export async function createServiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const l = await catalog.createService(getDb(), await requireActor(), serviceFrom(fd));
    redirect(`/app/services/${l.id}?created=1`);
  });
}

export async function updateServiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const sid = id(fd, "serviceId");
    await catalog.updateService(getDb(), await requireActor(), sid, serviceFrom(fd));
    revalidatePath(`/app/services/${sid}`);
    return { ok: true, message: "Service saved." };
  });
}

export async function serviceTransitionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const sid = id(fd, "serviceId");
    const to = str(fd, "to") as "pending_review" | "paused" | "published" | "archived";
    if (!["pending_review", "paused", "published", "archived"].includes(to)) throw new AppError("VALIDATION", "Unknown action");
    await catalog.ownerTransition(getDb(), await requireActor(), sid, to);
    redirect(`/app/services/${sid}?status=${to}`);
  });
}

export async function placeOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const r = await orders.placeOrder(getDb(), await requireActor(), { listingId: str(fd, "listingId"), tier: str(fd, "tier"), addonIds: strs(fd, "addonId") });
    redirect(r.actionUrl ?? `/app/orders/${r.order.id}`);
  });
}

export async function orderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const db = getDb();
    const oid = id(fd, "orderId");
    const op = str(fd, "op");
    let message = "Saved.";
    switch (op) {
      case "pay": {
        const r = await orders.resumeOrderPayment(db, actor, oid);
        if (r.actionUrl) redirect(r.actionUrl);
        break;
      }
      case "cancel":
        await orders.cancelUnpaidOrder(db, actor, oid);
        message = "Order canceled.";
        break;
      case "requirements": {
        const answers: Record<string, string> = {};
        for (const [k, v] of fd.entries()) if (k.startsWith("req_") && typeof v === "string") answers[k.slice(4)] = v;
        await orders.submitRequirements(db, actor, oid, answers);
        message = "Requirements submitted. The delivery clock has started.";
        break;
      }
      case "deliver": {
        const d = await orders.deliverOrder(db, actor, oid, { note: str(fd, "note") });
        const files = filesFrom(fd);
        if (files.length) await storeAttachments(db, actor, "order_delivery", d.id, files);
        message = "Delivery sent.";
        break;
      }
      case "revision":
        await orders.requestOrderRevision(db, actor, oid, { note: str(fd, "note") });
        message = "Revision requested.";
        break;
      case "approve":
        await orders.approveOrder(db, actor, oid);
        message = "Approved. Payment release requested from the provider.";
        break;
      default:
        throw new AppError("VALIDATION", "Unknown action");
    }
    revalidatePath(`/app/orders/${oid}`);
    return { ok: true, message };
  });
}

export async function simulateOrderProviderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const outcome = str(fd, "outcome") === "failed" ? "failed" : "succeeded";
    const r = await simulateTestProviderOutcome(getDb(), await requireActor(), id(fd, "intentId"), outcome);
    if (/^\/app\/(contracts|orders)\/[0-9a-f-]{36}$/.test(r.back)) redirect(`${r.back}?webhook=${r.outcome}`);
    return { ok: true, message: `Webhook processed: ${r.outcome}` };
  });
}

// ---------- milestone deliverable with files (fixed-price)
export async function deliverWithFilesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const db = getDb();
    const contractId = id(fd, "contractId");
    const { deliverMilestone } = await import("@/server/services/contracts");
    const sub = await deliverMilestone(db, actor, id(fd, "milestoneId"), { note: str(fd, "note") });
    const files = filesFrom(fd);
    if (files.length) {
      await enforceRateLimit(db, "upload", actor.userId);
      await storeAttachments(db, actor, "milestone_submission", sub.id, files);
    }
    revalidatePath(`/app/contracts/${contractId}`);
    return { ok: true, message: "Work submitted." };
  });
}

// ---------- agencies
export async function agencyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const db = getDb();
    const op = str(fd, "op");
    let message = "Saved.";
    switch (op) {
      case "create":
        await agencies.createAgency(db, actor, { name: str(fd, "name"), description: str(fd, "description") });
        message = "Agency created.";
        break;
      case "update":
        await agencies.updateAgency(db, actor, id(fd, "agencyId"), { name: str(fd, "name"), description: str(fd, "description") }, fd.get("publish") === "on");
        message = "Agency profile saved.";
        break;
      case "invite":
        await agencies.inviteMember(db, actor, id(fd, "agencyId"), str(fd, "email"), str(fd, "role") === "admin" ? "admin" : "member");
        message = "If that email belongs to a WorkSpring freelancer, they'll receive an invitation.";
        break;
      case "accept":
      case "decline":
        await agencies.respondAgencyInvitation(db, actor, id(fd, "invitationId"), op === "accept");
        message = op === "accept" ? "You joined the agency." : "Invitation declined.";
        break;
      case "revoke":
        await agencies.revokeAgencyInvitation(db, actor, id(fd, "invitationId"));
        message = "Invitation revoked.";
        break;
      case "remove":
        await agencies.removeMember(db, actor, id(fd, "agencyId"), id(fd, "userId"));
        message = str(fd, "userId") === actor.userId ? "You left the agency." : "Member removed. Their own account, contracts and history are unaffected.";
        break;
      case "role":
        await agencies.changeMemberRole(db, actor, id(fd, "agencyId"), id(fd, "userId"), str(fd, "role") === "admin" ? "admin" : "member");
        message = "Role updated.";
        break;
      default:
        throw new AppError("VALIDATION", "Unknown action");
    }
    revalidatePath("/app/agency");
    return { ok: true, message };
  });
}

// ---------- support
export async function openTicketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const db = getDb();
    const t = await support.openTicket(db, actor, { subject: str(fd, "subject"), category: str(fd, "category"), body: str(fd, "body") });
    const files = filesFrom(fd);
    if (files.length) await storeAttachments(db, actor, "support_ticket", t.id, files);
    redirect(`/app/support/${t.id}?created=1`);
  });
}

export async function ticketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const tid = id(fd, "ticketId");
    const op = str(fd, "op");
    if (op === "reply") await support.replyTicket(getDb(), actor, tid, str(fd, "body"));
    else await support.setTicketStatus(getDb(), actor, tid, op as "open" | "resolved" | "closed" | "waiting_on_user");
    revalidatePath(`/app/support/${tid}`);
    revalidatePath(`/admin/support/${tid}`);
    return { ok: true, message: op === "reply" ? "Reply sent." : `Ticket ${op.replace(/_/g, " ")}.` };
  });
}

// ---------- admin
export async function adminAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const db = getDb();
    const op = str(fd, "op");
    let message = "Done.";
    switch (op) {
      case "suspend":
      case "reinstate":
        await admin.setUserStatus(db, actor, id(fd, "userId"), op === "suspend" ? "suspended" : "active", str(fd, "reason"));
        message = op === "suspend" ? "User suspended and signed out everywhere." : "User reinstated.";
        break;
      case "grant":
      case "revoke_role":
        await admin.grantRole(db, actor, id(fd, "userId"), str(fd, "role") as "superadmin" | "support" | "moderator" | "finance", op === "grant");
        message = "Staff role updated.";
        break;
      case "moderate": {
        await admin.requireStaff(db, actor, "moderation.services");
        await catalog.moderateService(db, actor.userId, id(fd, "serviceId"), str(fd, "decision") === "approve" ? "approve" : "request_changes", str(fd, "note") || undefined);
        message = "Moderation decision recorded.";
        break;
      }
      case "report":
        await admin.handleReport(db, actor, id(fd, "reportId"), str(fd, "status") as "reviewing" | "actioned" | "dismissed", str(fd, "note"));
        message = "Report updated.";
        break;
      case "review_visibility": {
        await admin.requireStaff(db, actor, "moderation.reviews");
        await reviews.setReviewHidden(db, actor.userId, id(fd, "reviewId"), str(fd, "hidden") === "1", str(fd, "note"));
        message = "Review visibility updated.";
        break;
      }
      case "resolve_dispute": {
        const r = await disputes.resolveDispute(db, actor, id(fd, "disputeId"), str(fd, "outcome") === "refund" ? "refund" : "release", { note: str(fd, "note") });
        message = r.intentId ? `Refund requested from the provider (intent ${r.intentId.slice(0, 8)}…). It completes on the verified webhook.` : "Resolved: the client can now release payment.";
        break;
      }
      case "simulate_refund": {
        const r = await simulateTestProviderOutcome(db, actor, id(fd, "intentId"), str(fd, "outcome") === "failed" ? "failed" : "succeeded");
        message = `Provider webhook processed: ${r.outcome}.`;
        break;
      }
      default:
        throw new AppError("VALIDATION", "Unknown action");
    }
    revalidatePath("/admin", "layout");
    return { ok: true, message };
  });
}
