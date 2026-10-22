import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { contractEvents, contracts, timeEntries, timeEntryEvents, timesheetEvents, timesheets } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { billableMinor, roundMinutes, weekRange, weekStartOf, withinWeeklyLimit } from "@/domain/hourly";
import { feeMinor } from "@/domain/money";
import { type Actor, contractRole } from "@/domain/permissions";
import { assertTransition, contractMachine, type TimesheetStatus, timesheetMachine } from "@/domain/state-machines";
import { manualTimeSchema, memoSchema, parseOrThrow } from "@/domain/validation";
import { getPaymentProvider, type PaymentProvider } from "../payments";
import { isUniqueViolation } from "./db-errors";
import { notify } from "./notifications";
import { createIntent, postTransaction, registerPaymentHandler } from "./payments";

type Contract = typeof contracts.$inferSelect;
type Entry = typeof timeEntries.$inferSelect;

async function loadHourly(db: Executor, actor: Actor, contractId: string, lock = false) {
  const q = db.select().from(contracts).where(eq(contracts.id, contractId));
  const [c] = lock ? await q.for("update") : await q;
  const role = c ? contractRole(actor, c) : null;
  if (!c || !role) throw new AppError("NOT_FOUND", "Contract not found");
  if (c.contractType !== "hourly") throw new AppError("CONFLICT", "This is not an hourly contract");
  return { c, role };
}

function requireActiveFreelancer(c: Contract, role: string) {
  if (role !== "freelancer") throw new AppError("FORBIDDEN", "Only the freelancer logs time");
  if (c.status !== "active") throw new AppError("INVALID_TRANSITION", `Contract is ${c.status}`);
}

/** Minutes already logged (stopped, not deleted) in the given week for a contract. */
async function weekMinutes(db: Executor, contractId: string, weekStart: string, excludeId?: string) {
  const { start, end } = weekRange(weekStart);
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
    .from(timeEntries)
    .where(and(eq(timeEntries.contractId, contractId), isNull(timeEntries.deletedAt), gte(timeEntries.startedAt, start), lt(timeEntries.startedAt, end), excludeId ? sql`${timeEntries.id} <> ${excludeId}` : undefined));
  return Number(r?.n ?? 0);
}

async function weekLocked(db: Executor, contractId: string, weekStart: string) {
  const [t] = await db.select().from(timesheets).where(and(eq(timesheets.contractId, contractId), eq(timesheets.weekStart, weekStart)));
  return t && t.status !== "disputed" ? t : null;
}

async function logEvent(tx: Executor, entryId: string, actorId: string, kind: string, before: Partial<Entry> | null, after: Partial<Entry> | null) {
  const pick = (e: Partial<Entry> | null) => (e ? { startedAt: e.startedAt, endedAt: e.endedAt, minutes: e.minutes, memo: e.memo, source: e.source } : null);
  await tx.insert(timeEntryEvents).values({ timeEntryId: entryId, actorId, kind, before: pick(before), after: pick(after) });
}

/** Starts the web timer. One running timer per freelancer (partial unique index). */
export async function startTimer(db: DB, actor: Actor, contractId: string, raw: unknown = {}) {
  const { memo } = parseOrThrow(memoSchema, raw);
  try {
    return await db.transaction(async (tx) => {
      const { c, role } = await loadHourly(tx, actor, contractId);
      requireActiveFreelancer(c, role);
      if (await weekLocked(tx, c.id, weekStartOf(new Date()))) throw new AppError("CONFLICT", "This week's timesheet was already submitted");
      const [e] = await tx.insert(timeEntries).values({ contractId: c.id, freelancerId: actor.userId, source: "timer", startedAt: new Date(), memo }).returning();
      await logEvent(tx, e.id, actor.userId, "timer_started", null, e);
      return e;
    });
  } catch (e) {
    if (isUniqueViolation(e, "time_entries_one_running_uq")) throw new AppError("CONFLICT", "You already have a timer running. Stop it first.");
    throw e;
  }
}

/**
 * Stops the running timer. The session is rounded per roundMinutes(); if it would exceed the weekly limit it is
 * trimmed to the remaining allowance (and rejected if nothing remains), so the cap is never silently exceeded.
 */
export async function stopTimer(db: DB, actor: Actor, contractId: string, raw: unknown = {}, now = new Date()) {
  const { memo } = parseOrThrow(memoSchema, raw);
  return db.transaction(async (tx) => {
    const { c, role } = await loadHourly(tx, actor, contractId, true);
    if (role !== "freelancer") throw new AppError("FORBIDDEN", "Only the freelancer logs time");
    const [running] = await tx.select().from(timeEntries).where(and(eq(timeEntries.contractId, c.id), eq(timeEntries.freelancerId, actor.userId), isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt))).for("update");
    if (!running) throw new AppError("CONFLICT", "No timer is running on this contract");
    let minutes = roundMinutes(now.getTime() - running.startedAt.getTime());
    minutes = Math.min(minutes, 1440);
    const week = weekStartOf(running.startedAt);
    const used = await weekMinutes(tx, c.id, week, running.id);
    let trimmed = false;
    if (!withinWeeklyLimit(used, minutes, c.weeklyLimitMinutes)) {
      const remaining = (c.weeklyLimitMinutes ?? 0) - used;
      if (remaining <= 0) {
        await tx.update(timeEntries).set({ deletedAt: now, endedAt: now, updatedAt: now }).where(eq(timeEntries.id, running.id));
        await logEvent(tx, running.id, actor.userId, "discarded_over_limit", running, null);
        throw new AppError("CONFLICT", "Weekly limit reached: this session was not recorded");
      }
      minutes = remaining;
      trimmed = true;
    }
    const patch = { endedAt: now, minutes, memo: memo || running.memo, updatedAt: now };
    await tx.update(timeEntries).set(patch).where(eq(timeEntries.id, running.id));
    await logEvent(tx, running.id, actor.userId, trimmed ? "timer_stopped_trimmed_to_limit" : "timer_stopped", running, { ...running, ...patch });
    return { minutes, trimmed };
  });
}

/** Manual entry, only when the contract allows it. Labelled "manual" to both parties. */
export async function addManualEntry(db: DB, actor: Actor, raw: unknown) {
  const input = parseOrThrow(manualTimeSchema, raw);
  return db.transaction(async (tx) => {
    const { c, role } = await loadHourly(tx, actor, input.contractId, true);
    requireActiveFreelancer(c, role);
    if (!c.allowManualTime) throw new AppError("FORBIDDEN", "This contract doesn't allow manual time. Use the timer.");
    const startedAt = new Date(`${input.date}T09:00:00.000Z`);
    if (Number.isNaN(startedAt.getTime())) throw new AppError("VALIDATION", "Invalid date", { date: "Invalid date" });
    if (startedAt.getTime() > Date.now()) throw new AppError("VALIDATION", "Manual time can't be in the future", { date: "Future date" });
    if (startedAt < new Date(weekStartOf(c.startedAt))) throw new AppError("VALIDATION", "Date is before the contract started", { date: "Before contract start" });
    const week = weekStartOf(startedAt);
    if (await weekLocked(tx, c.id, week)) throw new AppError("CONFLICT", "That week's timesheet was already submitted");
    if (!withinWeeklyLimit(await weekMinutes(tx, c.id, week), input.minutes, c.weeklyLimitMinutes)) {
      throw new AppError("CONFLICT", "This entry would exceed the contract's weekly limit", { minutes: "Over the weekly limit" });
    }
    const endedAt = new Date(startedAt.getTime() + input.minutes * 60_000);
    const [e] = await tx.insert(timeEntries).values({ contractId: c.id, freelancerId: actor.userId, source: "manual", startedAt, endedAt, minutes: input.minutes, memo: input.memo }).returning();
    await logEvent(tx, e.id, actor.userId, "manual_created", null, e);
    return e;
  });
}

/** Edit memo (any unsubmitted entry) or delete an unsubmitted entry. Every change keeps before/after history. */
export async function changeEntry(db: DB, actor: Actor, entryId: string, op: "memo" | "delete", raw: unknown = {}) {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(timeEntries).where(eq(timeEntries.id, entryId)).for("update");
    if (!e || e.freelancerId !== actor.userId || e.deletedAt) throw new AppError("NOT_FOUND", "Entry not found");
    if (e.timesheetId) {
      const [t] = await tx.select().from(timesheets).where(eq(timesheets.id, e.timesheetId));
      if (t && t.status !== "disputed") throw new AppError("CONFLICT", "Entries on a submitted timesheet can't be changed");
    }
    if (op === "delete") {
      await tx.update(timeEntries).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(timeEntries.id, entryId));
      await logEvent(tx, e.id, actor.userId, "deleted", e, null);
    } else {
      const { memo } = parseOrThrow(memoSchema, raw);
      await tx.update(timeEntries).set({ memo, updatedAt: new Date() }).where(eq(timeEntries.id, entryId));
      await logEvent(tx, e.id, actor.userId, "memo_edited", e, { ...e, memo });
    }
  });
}

/** Freelancer submits a finished week (or resubmits a disputed one). Amount = billable minutes × snapshotted rate. */
export async function submitTimesheet(db: DB, actor: Actor, contractId: string, weekStart: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const { c, role } = await loadHourly(tx, actor, contractId, true);
    if (role !== "freelancer") throw new AppError("FORBIDDEN", "Only the freelancer submits timesheets");
    const { start, end } = (() => {
      try {
        return weekRange(weekStart);
      } catch {
        throw new AppError("VALIDATION", "Choose a valid week (Monday date)");
      }
    })();
    if (start.getTime() > now.getTime()) throw new AppError("VALIDATION", "That week hasn't started yet");
    const entries = await tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.contractId, c.id), isNull(timeEntries.deletedAt), gte(timeEntries.startedAt, start), lt(timeEntries.startedAt, end)));
    if (entries.some((e) => e.endedAt === null)) throw new AppError("CONFLICT", "Stop the running timer before submitting");
    const minutes = entries.reduce((a, e) => a + (e.minutes ?? 0), 0);
    if (minutes <= 0) throw new AppError("CONFLICT", "No time recorded for that week");
    const amountMinor = billableMinor(minutes, c.hourlyRateMinor!);
    const [existing] = await tx.select().from(timesheets).where(and(eq(timesheets.contractId, c.id), eq(timesheets.weekStart, weekStart))).for("update");
    let ts;
    if (existing) {
      assertTransition(timesheetMachine, existing.status, "submitted", "timesheet");
      [ts] = await tx.update(timesheets).set({ status: "submitted", minutes, amountMinor, submittedAt: now, updatedAt: now }).where(eq(timesheets.id, existing.id)).returning();
      await tx.insert(timesheetEvents).values({ timesheetId: ts.id, actorId: actor.userId, fromStatus: existing.status, toStatus: "submitted", note: "resubmitted after dispute" });
    } else {
      [ts] = await tx.insert(timesheets).values({ contractId: c.id, weekStart, minutes, amountMinor, currency: c.currency }).returning();
      await tx.insert(timesheetEvents).values({ timesheetId: ts.id, actorId: actor.userId, fromStatus: null, toStatus: "submitted" });
    }
    await tx.update(timeEntries).set({ timesheetId: ts.id }).where(inArray(timeEntries.id, entries.map((e) => e.id)));
    await notify(tx, { userId: c.clientId, category: "contracts", kind: "timesheet.submitted", title: `Timesheet submitted for the week of ${weekStart}`, body: "Approve it or raise a dispute.", link: `/app/contracts/${c.id}`, dedupeKey: `timesheet.submitted:${ts.id}:${now.getTime()}` });
    return ts;
  });
}

async function lockTimesheet(tx: Executor, actor: Actor, id: string) {
  const [row] = await tx.select({ t: timesheets, c: contracts }).from(timesheets).innerJoin(contracts, eq(contracts.id, timesheets.contractId)).where(eq(timesheets.id, id)).for("update", { of: timesheets });
  const role = row ? contractRole(actor, row.c) : null;
  if (!row || !role) throw new AppError("NOT_FOUND", "Timesheet not found");
  return { ...row, role };
}

async function moveTimesheet(tx: Executor, t: typeof timesheets.$inferSelect, to: TimesheetStatus, actor: { id: string | null; kind: string }, extra: Partial<typeof timesheets.$inferInsert> = {}, note?: string) {
  assertTransition(timesheetMachine, t.status, to, "timesheet");
  await tx.update(timesheets).set({ status: to, updatedAt: new Date(), ...extra }).where(eq(timesheets.id, t.id));
  await tx.insert(timesheetEvents).values({ timesheetId: t.id, actorId: actor.id, actorKind: actor.kind, fromStatus: t.status, toStatus: to, note: note ?? null });
}

/** Client disputes a submitted week with a reason; the freelancer can correct entries and resubmit. */
export async function disputeTimesheet(db: DB, actor: Actor, id: string, reason: string) {
  const r = reason.trim();
  if (r.length < 10) throw new AppError("VALIDATION", "Explain the dispute (at least 10 characters)", { reason: "At least 10 characters" });
  return db.transaction(async (tx) => {
    const { t, c, role } = await lockTimesheet(tx, actor, id);
    if (role !== "client") throw new AppError("FORBIDDEN", "Only the client reviews timesheets");
    await moveTimesheet(tx, t, "disputed", { id: actor.userId, kind: "user" }, { disputeReason: r.slice(0, 2000) }, r.slice(0, 500));
    await notify(tx, { userId: c.freelancerId, category: "contracts", kind: "timesheet.disputed", title: `Timesheet disputed (week of ${t.weekStart})`, body: r.slice(0, 200), link: `/app/contracts/${c.id}`, dedupeKey: `timesheet.disputed:${t.id}:${Date.now()}` });
  });
}

/** Client approves a week, which immediately requests the provider payment; "paid" only on a verified webhook. */
export async function approveTimesheet(db: DB, actor: Actor, id: string, provider: PaymentProvider = getPaymentProvider()) {
  if (!provider.configured) throw new AppError("PROVIDER_UNCONFIGURED", provider.unavailableReason ?? "Payments are not configured");
  return db.transaction(async (tx) => {
    const { t, c, role } = await lockTimesheet(tx, actor, id);
    if (role !== "client") throw new AppError("FORBIDDEN", "Only the client approves timesheets");
    if (t.status !== "submitted" && t.status !== "approved") throw new AppError("INVALID_TRANSITION", `Timesheet is ${t.status.replace("_", " ")}`);
    if (t.status === "submitted") await moveTimesheet(tx, t, "approved", { id: actor.userId, kind: "user" }, { approvedAt: new Date() });
    const current = { ...t, status: (t.status === "submitted" ? "approved" : t.status) as TimesheetStatus };
    const fee = c.feeRuleSnapshot as { freelancerFeeBps: number };
    const res = await createIntent(tx, provider, { purpose: "timesheet_payment", target: { timesheetId: t.id }, amountMinor: t.amountMinor, feeMinor: feeMinor(t.amountMinor, fee.freelancerFeeBps), currency: t.currency, description: `Hourly week of ${t.weekStart}`, createdBy: actor.userId });
    await moveTimesheet(tx, current, "payment_pending", { id: actor.userId, kind: "user" }, {}, `intent ${res.intentId}`);
    return res;
  });
}

/** Either party may end an hourly contract once no timer is running. Submitted weeks stay reviewable. */
export async function endHourlyContract(db: DB, actor: Actor, contractId: string) {
  return db.transaction(async (tx) => {
    const { c } = await loadHourly(tx, actor, contractId, true);
    const [running] = await tx.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.contractId, c.id), isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)));
    if (running) throw new AppError("CONFLICT", "Stop the running timer first");
    assertTransition(contractMachine, c.status, "completed", "contract");
    await tx.update(contracts).set({ status: "completed", endedAt: new Date() }).where(eq(contracts.id, c.id));
    await tx.insert(contractEvents).values({ contractId: c.id, actorId: actor.userId, kind: "contract.ended", data: { by: actor.userId } });
    const other = actor.userId === c.clientId ? c.freelancerId : c.clientId;
    await notify(tx, { userId: other, category: "contracts", kind: "contract.ended", title: `Contract ended: ${c.title}`, body: "You can now leave a review.", link: `/app/contracts/${c.id}`, dedupeKey: `contract.ended:${c.id}` });
  });
}

export async function getHourlyWorkroom(db: Executor, actor: Actor, contractId: string) {
  const { c, role } = await loadHourly(db, actor, contractId);
  const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.contractId, c.id), isNull(timeEntries.deletedAt))).orderBy(desc(timeEntries.startedAt)).limit(300);
  const sheets = await db.select().from(timesheets).where(eq(timesheets.contractId, c.id)).orderBy(desc(timesheets.weekStart));
  const sheetEvents = sheets.length ? await db.select().from(timesheetEvents).where(inArray(timesheetEvents.timesheetId, sheets.map((s) => s.id))).orderBy(asc(timesheetEvents.createdAt)) : [];
  const running = entries.find((e) => e.endedAt === null) ?? null;
  const thisWeek = weekStartOf(new Date());
  const thisWeekMinutes = await weekMinutes(db, c.id, thisWeek);
  const weeks = [...new Set(entries.filter((e) => e.endedAt).map((e) => weekStartOf(e.startedAt)))].sort().reverse();
  const unsubmittedWeeks = weeks
    .map((w) => ({ week: w, minutes: entries.filter((e) => e.endedAt && weekStartOf(e.startedAt) === w).reduce((a, e) => a + (e.minutes ?? 0), 0), sheet: sheets.find((s) => s.weekStart === w) ?? null }))
    .filter((w) => !w.sheet || w.sheet.status === "disputed");
  return { contract: c, role, entries, running, sheets: sheets.map((s) => ({ ...s, events: sheetEvents.filter((e) => e.timesheetId === s.id) })), thisWeek, thisWeekMinutes, unsubmittedWeeks };
}

registerPaymentHandler("timesheet_payment", async (tx, intent, succeeded, event) => {
  const [t] = await tx.select().from(timesheets).where(eq(timesheets.id, intent.timesheetId!)).for("update");
  const [c] = await tx.select().from(contracts).where(eq(contracts.id, t.contractId));
  const actor = { id: null, kind: "provider_webhook" };
  if (succeeded) {
    await moveTimesheet(tx, t, "paid", actor, { paidAt: new Date() }, `event ${event.id}`);
    await postTransaction(tx, { mode: intent.mode, currency: intent.currency, contractId: c.id, milestoneId: null, paymentIntentId: intent.id, memo: `Hourly week of ${t.weekStart} paid (${intent.mode})` }, [
      { account: "provider_balance", direction: "debit", amountMinor: intent.amountMinor },
      { account: "freelancer_payable", direction: "credit", amountMinor: intent.amountMinor - intent.feeMinor },
      { account: "platform_fee_revenue", direction: "credit", amountMinor: intent.feeMinor },
    ]);
    await notify(tx, { userId: c.freelancerId, category: "payments", kind: "timesheet.paid", title: `Timesheet paid (week of ${t.weekStart})`, body: intent.mode === "test" ? "TEST MODE: no real money moved." : undefined, link: `/app/contracts/${c.id}`, dedupeKey: `timesheet.paid:${intent.id}` });
  } else {
    await moveTimesheet(tx, t, "approved", actor, {}, `payment failed: ${event.failureReason ?? "unknown"}`);
  }
});
