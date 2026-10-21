import Link from "next/link";
import { notFound } from "next/navigation";
import { respondOfferAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { Card, LinkButton, Notice, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { formatMoney } from "@/domain/money";
import { requireActor } from "@/lib/session";
import { getOffer } from "@/server/services/contracts";

export const metadata = { title: "Offer" };
type Snap = { milestones: { seq: number; title: string; amountMinor: number; dueDate: string | null }[]; feeRule: { version: number; freelancerFeeBps: number }; paymentMode: string; policies: Record<string, string> };

export default async function OfferDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { sent } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let o;
  try {
    o = await getOffer(getDb(), actor, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const snap = o.termsSnapshot as unknown as Snap;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={o.title} subtitle={<span className="inline-flex items-center gap-2"><StatusBadge status={o.effectiveStatus} /> {o.clientName} → {o.freelancerName}</span>} />
      {sent ? <Notice tone="success">Offer sent. The freelancer has until {formatDate(o.expiresAt)} to respond.</Notice> : null}
      {o.contractId ? <Notice tone="success">Accepted. <Link href={`/app/contracts/${o.contractId}`} className="underline">Open the contract workroom</Link>.</Notice> : null}
      <Card className="space-y-3 text-sm">
        <h2 className="text-base font-semibold">Terms (immutable snapshot)</h2>
        <p className="whitespace-pre-wrap text-ink-soft">{o.description}</p>
        <table className="w-full text-left">
          <caption className="sr-only">Milestones</caption>
          <thead className="text-xs uppercase text-muted"><tr><th scope="col" className="py-1">#</th><th scope="col">Milestone</th><th scope="col">Due</th><th scope="col" className="text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-line">
            {snap.milestones.map((m) => <tr key={m.seq}><td className="py-1.5">{m.seq}</td><td>{m.title}</td><td>{m.dueDate ?? "-"}</td><td className="text-right">{formatMoney(m.amountMinor, o.currency)}</td></tr>)}
          </tbody>
          <tfoot><tr className="font-semibold"><td /><td>Total</td><td /><td className="text-right">{formatMoney(o.totalMinor, o.currency)}</td></tr></tfoot>
        </table>
        <p className="text-muted">Fee rule v{snap.feeRule.version}: {(snap.feeRule.freelancerFeeBps / 100).toFixed(2)}% deducted from each released milestone. Payment mode: {snap.paymentMode}. Expires {formatDate(o.expiresAt)}.</p>
        <p className="text-muted">{snap.policies.review}. {snap.policies.terms}.</p>
      </Card>
      {o.effectiveStatus === "sent" && o.viewerRole === "freelancer" ? (
        <Card className="flex flex-wrap items-start gap-3">
          <ActionForm action={respondOfferAction} submitLabel="Accept offer and start contract" variant="accent" inline confirm="Accept these terms and start the contract?">
            <input type="hidden" name="offerId" value={o.id} /><input type="hidden" name="op" value="accept" />
          </ActionForm>
          <ActionForm action={respondOfferAction} submitLabel="Decline" variant="danger" inline confirm="Decline this offer? Your proposal will be withdrawn.">
            <input type="hidden" name="offerId" value={o.id} /><input type="hidden" name="op" value="decline" />
          </ActionForm>
        </Card>
      ) : null}
      {o.effectiveStatus === "sent" && o.viewerRole === "client" ? (
        <ActionForm action={respondOfferAction} submitLabel="Withdraw offer" variant="danger" confirm="Withdraw this offer?">
          <input type="hidden" name="offerId" value={o.id} /><input type="hidden" name="op" value="withdraw" />
        </ActionForm>
      ) : null}
      <LinkButton href={`/app/proposals/${o.proposalId}`} variant="secondary">Back to proposal</LinkButton>
      <section>
        <h2 className="mb-2 font-semibold">History</h2>
        <ol className="space-y-1 text-sm text-muted">{o.events.map((e) => <li key={e.id}>{formatDate(e.createdAt)}: {e.fromStatus ?? "new"} → {e.toStatus}</li>)}</ol>
      </section>
    </div>
  );
}
