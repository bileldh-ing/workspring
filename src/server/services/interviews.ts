import { desc, eq, inArray, or } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { interviewEvents, interviews, jobs, proposals, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { type Actor, requireCapability } from "@/domain/permissions";
import { assertTransition, interviewMachine } from "@/domain/state-machines";
import { interviewSchema, parseOrThrow } from "@/domain/validation";
import { signLiveKitToken, videoConfig } from "../video/livekit";
import { notify } from "./notifications";
import { assertNotBlocked } from "./safety";

type IvStatus = (typeof interviews.$inferSelect)["status"];
const JOIN_EARLY_MS = 15 * 60_000;

export async function scheduleInterview(db: DB, actor: Actor, raw: unknown) {
  requireCapability(actor, "client");
  const input = parseOrThrow(interviewSchema, raw);
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() < Date.now() + 5 * 60_000) throw new AppError("VALIDATION", "Pick a time at least 5 minutes from now", { startsAt: "Must be in the future" });
  if (startsAt.getTime() > Date.now() + 90 * 86400_000) throw new AppError("VALIDATION", "Pick a time within the next 90 days", { startsAt: "Too far ahead" });
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ p: proposals, job: jobs }).from(proposals).innerJoin(jobs, eq(jobs.id, proposals.jobId)).where(eq(proposals.id, input.proposalId));
    if (!row || row.job.clientId !== actor.userId) throw new AppError("NOT_FOUND", "Proposal not found");
    if (!["submitted", "shortlisted", "offer_sent"].includes(row.p.status)) throw new AppError("CONFLICT", `Can't schedule an interview on a ${row.p.status} proposal`);
    await assertNotBlocked(tx, actor.userId, row.p.freelancerId);
    const [iv] = await tx
      .insert(interviews)
      .values({ proposalId: row.p.id, clientId: actor.userId, freelancerId: row.p.freelancerId, startsAt, durationMinutes: input.durationMinutes, agenda: input.agenda || null, roomName: `ws-iv-${crypto.randomUUID()}` })
      .returning();
    await tx.insert(interviewEvents).values({ interviewId: iv.id, actorId: actor.userId, fromStatus: null, toStatus: "proposed" });
    await notify(tx, { userId: row.p.freelancerId, category: "proposals", kind: "interview.proposed", title: `Interview request for "${row.job.title}"`, body: `Proposed for ${startsAt.toISOString().replace("T", " ").slice(0, 16)} UTC`, link: `/app/interviews`, dedupeKey: `interview.proposed:${iv.id}` });
    return iv;
  });
}

export async function listMyInterviews(db: Executor, actor: Actor) {
  const rows = await db
    .select({ iv: interviews, jobTitle: jobs.title, proposalId: proposals.id })
    .from(interviews)
    .innerJoin(proposals, eq(proposals.id, interviews.proposalId))
    .innerJoin(jobs, eq(jobs.id, proposals.jobId))
    .where(or(eq(interviews.clientId, actor.userId), eq(interviews.freelancerId, actor.userId)))
    .orderBy(desc(interviews.startsAt));
  const ids = [...new Set(rows.flatMap((r) => [r.iv.clientId, r.iv.freelancerId]))];
  const people = ids.length ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids)) : [];
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  return rows.map((r) => ({ ...r.iv, jobTitle: r.jobTitle, proposalId: r.proposalId, role: r.iv.clientId === actor.userId ? ("client" as const) : ("freelancer" as const), otherName: name(r.iv.clientId === actor.userId ? r.iv.freelancerId : r.iv.clientId) }));
}

export async function getInterview(db: Executor, actor: Actor, id: string) {
  const [iv] = await db.select().from(interviews).where(eq(interviews.id, id));
  if (!iv || (iv.clientId !== actor.userId && iv.freelancerId !== actor.userId)) throw new AppError("NOT_FOUND", "Interview not found");
  return iv;
}

export async function respondInterview(db: DB, actor: Actor, id: string, to: Extract<IvStatus, "confirmed" | "declined" | "canceled" | "completed">, note?: string) {
  return db.transaction(async (tx) => {
    const [iv] = await tx.select().from(interviews).where(eq(interviews.id, id)).for("update");
    if (!iv || (iv.clientId !== actor.userId && iv.freelancerId !== actor.userId)) throw new AppError("NOT_FOUND", "Interview not found");
    if ((to === "confirmed" || to === "declined") && actor.userId !== iv.freelancerId) throw new AppError("FORBIDDEN", "Only the invited freelancer can confirm or decline");
    if (to === "completed" && actor.userId !== iv.clientId) throw new AppError("FORBIDDEN", "Only the client can mark an interview completed");
    assertTransition(interviewMachine, iv.status, to, "interview");
    await tx.update(interviews).set({ status: to, updatedAt: new Date() }).where(eq(interviews.id, id));
    await tx.insert(interviewEvents).values({ interviewId: id, actorId: actor.userId, fromStatus: iv.status, toStatus: to, note: note?.slice(0, 500) ?? null });
    const other = actor.userId === iv.clientId ? iv.freelancerId : iv.clientId;
    await notify(tx, { userId: other, category: "proposals", kind: `interview.${to}`, title: `Interview ${to}`, body: note?.slice(0, 200), link: `/app/interviews`, dedupeKey: `interview.${to}:${id}` });
  });
}

/** Issues a short-lived LiveKit token for a participant of a confirmed interview inside its time window. */
export async function joinInterview(db: Executor, actor: Actor, id: string, now = new Date()) {
  const iv = await getInterview(db, actor, id);
  const cfg = videoConfig();
  if (!cfg) throw new AppError("PROVIDER_UNCONFIGURED", "Video calls are not configured on this server (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET). Use another meeting tool and share the link in messages.");
  if (iv.status !== "confirmed") throw new AppError("INVALID_TRANSITION", "The interview must be confirmed before joining");
  const start = iv.startsAt.getTime();
  const end = start + iv.durationMinutes * 60_000;
  if (now.getTime() < start - JOIN_EARLY_MS) throw new AppError("CONFLICT", "The room opens 15 minutes before the start time");
  if (now.getTime() > end + 30 * 60_000) throw new AppError("CONFLICT", "This interview has ended");
  const ttl = Math.max(300, Math.floor((end + 30 * 60_000 - now.getTime()) / 1000));
  return { url: cfg.url, room: iv.roomName, token: signLiveKitToken(cfg, { identity: actor.userId, name: actor.displayName, room: iv.roomName, ttlSeconds: ttl }) };
}

/** RFC 5545 calendar invite for a participant. */
export function interviewIcs(iv: typeof interviews.$inferSelect, title: string) {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(iv.startsAt.getTime() + iv.durationMinutes * 60_000);
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkSpring//Interviews//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${iv.id}@workspring`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(iv.startsAt)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(`WorkSpring interview: ${title}`)}`,
    `DESCRIPTION:${esc(iv.agenda ?? "Join from your WorkSpring interviews page.")}`,
    `STATUS:${iv.status === "confirmed" ? "CONFIRMED" : iv.status === "canceled" ? "CANCELLED" : "TENTATIVE"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

