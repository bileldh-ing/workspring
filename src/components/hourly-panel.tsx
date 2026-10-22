import { hourlyAction, simulateOrderProviderAction } from "@/app/actions/r2";
import { formatMinutes } from "@/domain/hourly";
import { formatMoney } from "@/domain/money";
import type { getHourlyWorkroom } from "@/server/services/hourly";
import { ActionForm } from "./action-form";
import { Elapsed } from "./elapsed";
import { Card, Field, Input, Notice, StatusBadge, Textarea, formatDate } from "./ui";

type W = Awaited<ReturnType<typeof getHourlyWorkroom>>;

export function HourlyPanel({ w, pendingIntents, testMode }: { w: W; pendingIntents: Record<string, string>; testMode: boolean }) {
  const c = w.contract;
  const h = (op: string) => (
    <>
      <input type="hidden" name="contractId" value={c.id} />
      <input type="hidden" name="op" value={op} />
    </>
  );
  const limit = c.weeklyLimitMinutes ?? 0;
  const pct = limit ? Math.min(100, Math.round((w.thisWeekMinutes / limit) * 100)) : 0;
  return (
    <section aria-labelledby="hourly-h" className="space-y-4">
      <h2 id="hourly-h" className="text-lg font-semibold">Hourly work</h2>
      <Card className="space-y-3">
        <p className="text-sm text-ink-soft">
          Rate <strong>{formatMoney(c.hourlyRateMinor ?? 0, c.currency)}/hr</strong> · weekly limit <strong>{formatMinutes(limit)}</strong> · manual time {c.allowManualTime ? "allowed (labelled “manual”)" : "not allowed"}
        </p>
        <div>
          <div className="flex justify-between text-xs text-muted"><span>This week (from {w.thisWeek}, UTC)</span><span>{formatMinutes(w.thisWeekMinutes)} of {formatMinutes(limit)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-canvas" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Weekly limit used"><div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
        </div>
        <Notice>The web timer only records start and stop times while you run it. WorkSpring takes no screenshots and records no keystrokes, apps or activity. See the time tracking privacy note in the docs.</Notice>
        {w.role === "freelancer" && c.status === "active" ? (
          w.running ? (
            <div className="flex flex-wrap items-end gap-3 rounded-md border border-accent/40 bg-accent-soft p-3">
              <p className="text-sm font-semibold text-accent"><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-danger align-middle" aria-hidden="true" />Timer running · <Elapsed since={w.running.startedAt.toISOString()} /></p>
              <ActionForm action={hourlyAction} submitLabel="Stop timer" variant="danger" className="flex flex-wrap items-end gap-2">
                {h("stop")}
                <Field label="Memo" name="memo"><Input name="memo" id="stop-memo" defaultValue={w.running.memo} maxLength={500} /></Field>
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={hourlyAction} submitLabel="Start timer" variant="accent" className="flex flex-wrap items-end gap-2">
              {h("start")}
              <Field label="What are you working on?" name="memo"><Input name="memo" id="start-memo" maxLength={500} placeholder="e.g. API pagination" /></Field>
            </ActionForm>
          )
        ) : null}
        {w.role === "freelancer" && c.status === "active" && c.allowManualTime ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Add manual time</summary>
            <div className="mt-2">
              <ActionForm action={hourlyAction} submitLabel="Add entry" variant="secondary">
                {h("manual")}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date (UTC)" name="date"><Input name="date" id="manual-date" type="date" required /></Field>
                  <Field label="Minutes" name="minutes"><Input name="minutes" id="manual-minutes" type="number" min={1} max={1440} required /></Field>
                </div>
                <Field label="Memo" name="memo"><Input name="memo" id="manual-memo" required maxLength={500} /></Field>
              </ActionForm>
            </div>
          </details>
        ) : null}
      </Card>

      {w.role === "freelancer" && w.unsubmittedWeeks.length ? (
        <Card className="space-y-2">
          <h3 className="font-semibold">Ready to submit</h3>
          {w.unsubmittedWeeks.map((u) => (
            <div key={u.week} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>Week of {u.week}: {formatMinutes(u.minutes)} · {formatMoney(Math.floor((u.minutes * (c.hourlyRateMinor ?? 0) + 30) / 60), c.currency)}{u.sheet?.status === "disputed" ? " · disputed: fix entries, then resubmit" : ""}</span>
              <ActionForm action={hourlyAction} submitLabel={u.sheet ? "Resubmit timesheet" : "Submit timesheet"} variant="secondary" inline>
                {h("submit_week")}
                <input type="hidden" name="weekStart" value={u.week} />
              </ActionForm>
            </div>
          ))}
        </Card>
      ) : null}

      <Card className="space-y-3">
        <h3 className="font-semibold">Timesheets</h3>
        {w.sheets.length === 0 ? <p className="text-sm text-muted">No timesheets submitted yet.</p> : w.sheets.map((t) => (
          <div key={t.id} className="space-y-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Week of {t.weekStart} · {formatMinutes(t.minutes)} · {formatMoney(t.amountMinor, t.currency)}</p>
              <StatusBadge status={t.status} />
            </div>
            {t.disputeReason && t.status === "disputed" ? <p className="text-sm text-danger">Dispute: {t.disputeReason}</p> : null}
            {w.role === "client" && t.status === "submitted" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ActionForm action={hourlyAction} submitLabel={`Approve and pay ${formatMoney(t.amountMinor, t.currency)}${testMode ? " (test)" : ""}`} variant="accent">
                  {h("approve_week")}<input type="hidden" name="timesheetId" value={t.id} />
                </ActionForm>
                <ActionForm action={hourlyAction} submitLabel="Dispute this week" variant="danger">
                  {h("dispute_week")}<input type="hidden" name="timesheetId" value={t.id} />
                  <Field label="What's wrong with these hours?" name="reason"><Textarea name="reason" id={`reason-${t.id}`} rows={2} required /></Field>
                </ActionForm>
              </div>
            ) : null}
            {w.role === "client" && t.status === "approved" ? (
              <ActionForm action={hourlyAction} submitLabel="Retry payment" variant="secondary" inline>{h("approve_week")}<input type="hidden" name="timesheetId" value={t.id} /></ActionForm>
            ) : null}
            {t.status === "payment_pending" && pendingIntents[t.id] && testMode ? (
              <div className="flex flex-wrap gap-2">
                <a className="rounded-[var(--radius-control)] border border-line-strong px-3 py-1.5 text-sm font-semibold" href={`/test-provider/checkout/${pendingIntents[t.id]}`}>Open test checkout</a>
                <ActionForm action={simulateOrderProviderAction} submitLabel="Simulate provider: payment succeeded" variant="secondary" inline>
                  <input type="hidden" name="intentId" value={pendingIntents[t.id]} /><input type="hidden" name="outcome" value="succeeded" />
                </ActionForm>
              </div>
            ) : null}
            <details className="text-xs text-muted"><summary className="cursor-pointer">History</summary><ol className="mt-1 space-y-0.5">{t.events.map((e) => <li key={e.id}>{formatDate(e.createdAt)}: {e.fromStatus ?? "new"} → {e.toStatus} ({e.actorKind}){e.note ? `: ${e.note}` : ""}</li>)}</ol></details>
          </div>
        ))}
      </Card>

      <Card>
        <h3 className="mb-2 font-semibold">Time entries</h3>
        {w.entries.length === 0 ? <p className="text-sm text-muted">No time recorded yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted"><tr><th className="py-1">Started (UTC)</th><th>Duration</th><th>Source</th><th>Memo</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-line">
                {w.entries.map((e) => {
                  const sheet = w.sheets.find((s) => s.id === e.timesheetId);
                  const editable = w.role === "freelancer" && e.endedAt && (!sheet || sheet.status === "disputed");
                  return (
                    <tr key={e.id}>
                      <td className="py-1.5 pr-2">{formatDate(e.startedAt)}</td>
                      <td className="pr-2">{e.minutes ? formatMinutes(e.minutes) : "running"}</td>
                      <td className="pr-2"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${e.source === "manual" ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand"}`}>{e.source}</span></td>
                      <td className="pr-2">{e.memo || <span className="text-muted">-</span>}</td>
                      <td>{editable ? (
                        <ActionForm action={hourlyAction} submitLabel="Delete" variant="ghost" inline confirm="Delete this time entry?">
                          {h("delete_entry")}<input type="hidden" name="entryId" value={e.id} />
                        </ActionForm>
                      ) : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {c.status === "active" ? (
        <ActionForm action={hourlyAction} submitLabel="End contract" variant="danger" confirm="End this hourly contract? Submitted timesheets stay reviewable; no new time can be logged.">{h("end")}</ActionForm>
      ) : null}
    </section>
  );
}
