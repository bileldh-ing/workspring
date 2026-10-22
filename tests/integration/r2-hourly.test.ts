import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries, timeEntries, timesheets } from "@/db/schema";
import { weekStartOf } from "@/domain/hourly";
import { acceptOffer, createOffer } from "@/server/services/contracts";
import { addManualEntry, approveTimesheet, changeEntry, disputeTimesheet, endHourlyContract, getHourlyWorkroom, startTimer, stopTimer, submitTimesheet } from "@/server/services/hourly";
import { simulateTestProviderOutcome } from "@/server/services/payments";
import { closeTestDb, hireSetup, makeUser, resetDb, testDb } from "../helpers";

const db = testDb();
beforeAll(() => resetDb(db));
afterAll(() => closeTestDb());

async function hourlyContract(opts: { manual?: boolean; limit?: number } = {}) {
  const s = await hireSetup(db, "hourly");
  await expect(createOffer(db, s.client, { proposalId: s.proposal.id, title: "Wrong type offer", description: "Fixed offer on an hourly job.", milestones: [{ title: "xyz", amount: "10" }] })).rejects.toMatchObject({ code: "CONFLICT" });
  const offer = await createOffer(db, s.client, { proposalId: s.proposal.id, title: "Hourly support contract", description: "Ongoing support work on the dashboard.", hourlyRate: "40", weeklyLimitHours: opts.limit ?? 10, allowManualTime: opts.manual ?? false });
  expect(offer.contractType).toBe("hourly");
  expect(offer.totalMinor).toBe(4000 * (opts.limit ?? 10));
  const contract = await acceptOffer(db, s.freelancer, offer.id);
  return { ...s, contract };
}

describe("hourly contracts", () => {
  it("timer start/stop, one running timer, memo history, and isolation", async () => {
    const { client, freelancer, contract } = await hourlyContract();
    await expect(startTimer(db, client, contract.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const e = await startTimer(db, freelancer, contract.id, { memo: "Fixing filters" });
    await expect(startTimer(db, freelancer, contract.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const r = await stopTimer(db, freelancer, contract.id, {}, new Date(e.startedAt.getTime() + 25 * 60_000));
    expect(r.minutes).toBe(25);
    await changeEntry(db, freelancer, e.id, "memo", { memo: "Fixed date filters" });
    const outsider = await makeUser(db, "hire");
    await expect(getHourlyWorkroom(db, outsider, contract.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const wr = await getHourlyWorkroom(db, client, contract.id);
    expect(wr.entries[0].memo).toBe("Fixed date filters");
    await expect(addManualEntry(db, freelancer, { contractId: contract.id, date: new Date().toISOString().slice(0, 10), minutes: 30, memo: "Manual work" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enforces the weekly limit on manual entries and trims timer sessions to the remaining allowance", async () => {
    const { freelancer, contract } = await hourlyContract({ manual: true, limit: 1 });
    const today = new Date().toISOString().slice(0, 10);
    await addManualEntry(db, freelancer, { contractId: contract.id, date: today, minutes: 50, memo: "Planning session" });
    await expect(addManualEntry(db, freelancer, { contractId: contract.id, date: today, minutes: 20, memo: "Over the limit" })).rejects.toMatchObject({ code: "CONFLICT" });
    const e = await startTimer(db, freelancer, contract.id);
    const r = await stopTimer(db, freelancer, contract.id, {}, new Date(e.startedAt.getTime() + 30 * 60_000));
    expect(r).toEqual({ minutes: 10, trimmed: true });
    const e2 = await startTimer(db, freelancer, contract.id);
    await expect(stopTimer(db, freelancer, contract.id, {}, new Date(e2.startedAt.getTime() + 5 * 60_000))).rejects.toMatchObject({ code: "CONFLICT" });
    const [{ n }] = await db.select({ n: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` }).from(timeEntries).where(and(eq(timeEntries.contractId, contract.id), isNull(timeEntries.deletedAt)));
    expect(Number(n)).toBe(60);
  });

  it("weekly timesheet: submit → dispute → correct → resubmit → approve → paid only via verified webhook, with a balanced ledger", async () => {
    const { client, freelancer, contract } = await hourlyContract({ manual: true });
    const today = new Date().toISOString().slice(0, 10);
    const entry = await addManualEntry(db, freelancer, { contractId: contract.id, date: today, minutes: 90, memo: "API integration" });
    await addManualEntry(db, freelancer, { contractId: contract.id, date: today, minutes: 30, memo: "Accidental duplicate" });
    const week = weekStartOf(new Date());
    await expect(submitTimesheet(db, client, contract.id, week)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ts = await submitTimesheet(db, freelancer, contract.id, week);
    expect(ts.minutes).toBe(120);
    expect(ts.amountMinor).toBe(8000); // 2h × $40
    await expect(addManualEntry(db, freelancer, { contractId: contract.id, date: today, minutes: 10, memo: "Late addition" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(disputeTimesheet(db, client, ts.id, "short")).rejects.toMatchObject({ code: "VALIDATION" });
    await disputeTimesheet(db, client, ts.id, "The 30 minute entry looks like a duplicate.");
    const [dup] = await db.select().from(timeEntries).where(and(eq(timeEntries.contractId, contract.id), eq(timeEntries.memo, "Accidental duplicate")));
    await changeEntry(db, freelancer, dup.id, "delete");
    const re = await submitTimesheet(db, freelancer, contract.id, week);
    expect(re.id).toBe(ts.id);
    expect(re.amountMinor).toBe(6000);
    await expect(changeEntry(db, freelancer, entry.id, "delete")).rejects.toMatchObject({ code: "CONFLICT" });

    const pay = await approveTimesheet(db, client, ts.id);
    expect((await db.select().from(timesheets).where(eq(timesheets.id, ts.id)))[0].status).toBe("payment_pending");
    await expect(approveTimesheet(db, client, ts.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await simulateTestProviderOutcome(db, client, pay.intentId, "succeeded");
    expect((await db.select().from(timesheets).where(eq(timesheets.id, ts.id)))[0].status).toBe("paid");
    const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.contractId, contract.id));
    const sum = (d: string) => ledger.filter((l) => l.direction === d).reduce((a, l) => a + l.amountMinor, 0);
    expect(sum("debit")).toBe(6000);
    expect(sum("credit")).toBe(6000);
    expect(ledger.find((l) => l.account === "platform_fee_revenue")?.amountMinor).toBe(600);

    await endHourlyContract(db, client, contract.id);
    await expect(startTimer(db, freelancer, contract.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
