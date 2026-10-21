import { notFound } from "next/navigation";
import { milestoneAction, simulateProviderAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Notice, PageHeader, StatusBadge, TestModeBadge, Textarea, formatDate, statusLabel } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { formatMoney, splitRelease } from "@/domain/money";
import { requireActor } from "@/lib/session";
import { getPaymentProvider } from "@/server/payments";
import { getWorkroom } from "@/server/services/contracts";

export const metadata = { title: "Contract workroom" };

const MILESTONE_HELP: Record<string, string> = {
  unfunded: "Waiting for the client to fund this milestone. Work shouldn't start yet.",
  funding_pending: "Payment started. It becomes funded only when the provider confirms via a verified webhook.",
  funded: "Provider confirmed the payment. The freelancer can deliver.",
  submitted: "Work submitted. The client can approve or request a revision.",
  revision_requested: "The client asked for changes. Resubmit when ready.",
  approved: "Approved. A release (transfer) needs to be requested.",
  release_pending: "Release requested. Waiting for the provider to confirm the transfer.",
  released: "Released: the provider confirmed the transfer.",
};

export default async function Workroom({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ started?: string; webhook?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let w;
  try {
    w = await getWorkroom(getDb(), actor, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const provider = getPaymentProvider();
  const c = w.contract;
  const fee = c.feeRuleSnapshot as { freelancerFeeBps: number; version: number };
  const hidden = (mId: string, op: string) => (
    <>
      <input type="hidden" name="milestoneId" value={mId} />
      <input type="hidden" name="contractId" value={c.id} />
      <input type="hidden" name="op" value={op} />
    </>
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title={c.title}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /> {w.clientName} (client) · {w.freelancerName} (freelancer) · {formatMoney(c.totalMinor, c.currency)} fixed · started {formatDate(c.startedAt)}</span>}
        actions={provider.mode === "test" ? <TestModeBadge /> : null}
      />
      {sp.started ? <Notice tone="success">Contract started. The client funds milestone 1 next.</Notice> : null}
      {sp.webhook ? <Notice tone={sp.webhook === "applied" ? "success" : "warn"}>Provider webhook processed: {sp.webhook}</Notice> : null}
      {!provider.configured ? <Notice tone="warn" title="Payments are not configured">{provider.unavailableReason} Funding and release are disabled; nothing is simulated.</Notice> : null}
      <Notice>
        WorkSpring does not hold funds or offer escrow/payment protection. &ldquo;Funded&rdquo; and &ldquo;released&rdquo; reflect provider-confirmed events recorded in the ledger{provider.mode === "test" ? "; in test mode no real money moves" : ""}. Fee rule v{fee.version}: {(fee.freelancerFeeBps / 100).toFixed(2)}% on release.
      </Notice>

      <section aria-labelledby="ms-h" className="space-y-3">
        <h2 id="ms-h" className="text-lg font-semibold">Milestones</h2>
        {w.milestones.map((m) => {
          const split = splitRelease(m.amountMinor, fee.freelancerFeeBps);
          const pendingIntent = m.intents.find((i) => i.status === "requires_action" || i.status === "processing");
          return (
            <Card key={m.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{m.seq}. {m.title}</h3>
                  <p className="text-sm text-muted">{formatMoney(m.amountMinor, m.currency)}{m.dueDate ? ` · due ${m.dueDate}` : ""} · freelancer receives {formatMoney(split.netMinor, m.currency)} after a {formatMoney(split.feeMinor, m.currency)} fee</p>
                </div>
                <StatusBadge status={m.status} />
              </div>
              <p className="text-sm text-ink-soft">{MILESTONE_HELP[m.status] ?? ""}</p>

              {c.status === "active" ? (
                <div className="flex flex-wrap items-start gap-3">
                  {w.role === "client" && m.status === "unfunded" && provider.configured ? (
                    <ActionForm action={milestoneAction} submitLabel={`Fund ${formatMoney(m.amountMinor, m.currency)}${provider.mode === "test" ? " (test)" : ""}`} inline>{hidden(m.id, "fund")}</ActionForm>
                  ) : null}
                  {m.status === "funding_pending" && pendingIntent && provider.mode === "test" ? (
                    <a className="rounded-[var(--radius-control)] border border-line-strong px-4 py-2 text-sm font-semibold" href={`/test-provider/checkout/${pendingIntent.id}`}>Open test checkout</a>
                  ) : null}
                  {m.status === "release_pending" && pendingIntent && provider.mode === "test" ? (
                    <ActionForm action={simulateProviderAction} submitLabel="Simulate provider: transfer succeeded" variant="secondary" inline>
                      <input type="hidden" name="intentId" value={pendingIntent.id} /><input type="hidden" name="outcome" value="succeeded" /><input type="hidden" name="back" value={`/app/contracts/${c.id}`} />
                    </ActionForm>
                  ) : null}
                  {m.status === "release_pending" && pendingIntent && provider.mode === "test" ? (
                    <ActionForm action={simulateProviderAction} submitLabel="Simulate provider: transfer failed" variant="ghost" inline>
                      <input type="hidden" name="intentId" value={pendingIntent.id} /><input type="hidden" name="outcome" value="failed" /><input type="hidden" name="back" value={`/app/contracts/${c.id}`} />
                    </ActionForm>
                  ) : null}
                  {w.role === "client" && m.status === "approved" && provider.configured ? (
                    <ActionForm action={milestoneAction} submitLabel="Retry release" variant="secondary" inline>{hidden(m.id, "retry_release")}</ActionForm>
                  ) : null}
                </div>
              ) : null}

              {c.status === "active" && w.role === "freelancer" && (m.status === "funded" || m.status === "revision_requested") ? (
                <ActionForm action={milestoneAction} submitLabel={m.status === "funded" ? "Submit work" : "Resubmit work"}>
                  {hidden(m.id, "deliver")}
                  <Field label="Delivery note" name={`note`} hint="10–5000 characters. File attachments are planned (private object storage).">
                    <Textarea name="note" rows={3} required />
                  </Field>
                </ActionForm>
              ) : null}

              {c.status === "active" && w.role === "client" && m.status === "submitted" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <ActionForm action={milestoneAction} submitLabel="Approve and release payment" variant="accent" confirm="Approve this work and request the release?">{hidden(m.id, "approve")}</ActionForm>
                  <ActionForm action={milestoneAction} submitLabel="Request revision" variant="secondary">
                    {hidden(m.id, "revision")}
                    <Field label="What needs to change?" name="note"><Textarea name="note" rows={2} required /></Field>
                  </ActionForm>
                </div>
              ) : null}

              {m.submissions.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Deliveries and revisions ({m.submissions.length + m.revisions.length})</summary>
                  <ol className="mt-2 space-y-2 text-sm">
                    {[...m.submissions.map((s) => ({ at: s.createdAt, k: `s${s.id}`, text: `Delivery v${s.version}: ${s.note}` })), ...m.revisions.map((r) => ({ at: r.createdAt, k: `r${r.id}`, text: `Revision requested: ${r.note}` }))]
                      .sort((a, b) => +a.at - +b.at)
                      .map((x) => <li key={x.k} className="rounded-md bg-canvas px-3 py-2"><span className="text-xs text-muted">{formatDate(x.at)}</span><p className="whitespace-pre-wrap">{x.text}</p></li>)}
                  </ol>
                </details>
              ) : null}
              <details>
                <summary className="cursor-pointer text-sm font-semibold">Event history</summary>
                <ol className="mt-2 space-y-1 text-xs text-muted">
                  {m.events.map((e) => <li key={e.id}>{formatDate(e.createdAt)}: {statusLabel(e.fromStatus ?? "new")} → {statusLabel(e.toStatus)} by {e.actorName}</li>)}
                </ol>
              </details>
            </Card>
          );
        })}
      </section>

      <section aria-labelledby="ledger-h">
        <h2 id="ledger-h" className="mb-2 text-lg font-semibold">Ledger entries {provider.mode === "test" ? <TestModeBadge /> : null}</h2>
        {w.ledger.length === 0 ? <p className="text-sm text-muted">No provider-confirmed money movements yet.</p> : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Double-entry ledger lines for this contract</caption>
              <thead className="border-b border-line bg-canvas text-xs uppercase text-muted"><tr><th scope="col" className="px-3 py-2">When</th><th scope="col" className="px-3 py-2">Account</th><th scope="col" className="px-3 py-2">Debit</th><th scope="col" className="px-3 py-2">Credit</th><th scope="col" className="px-3 py-2">Memo</th></tr></thead>
              <tbody className="divide-y divide-line">
                {w.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5 text-muted">{formatDate(l.createdAt)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{l.account}</td>
                    <td className="px-3 py-1.5">{l.direction === "debit" ? formatMoney(l.amountMinor, l.currency) : ""}</td>
                    <td className="px-3 py-1.5">{l.direction === "credit" ? formatMoney(l.amountMinor, l.currency) : ""}</td>
                    <td className="px-3 py-1.5 text-muted">{l.memo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Contract history</h2>
        <ol className="space-y-1 text-sm text-muted">{w.events.map((e) => <li key={e.id}>{formatDate(e.createdAt)}: {e.kind}</li>)}</ol>
      </section>
    </div>
  );
}
