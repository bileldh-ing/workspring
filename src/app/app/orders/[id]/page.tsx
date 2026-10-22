import Link from "next/link";
import { notFound } from "next/navigation";
import { orderAction, reviewAction, simulateOrderProviderAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { FileInput, FileList, Stars } from "@/components/r2";
import { Card, Field, Notice, PageHeader, Select, StatusBadge, TestModeBadge, Textarea, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { formatMoney } from "@/domain/money";
import { requireActor } from "@/lib/session";
import { getPaymentProvider } from "@/server/payments";
import { listAttachments } from "@/server/services/files";
import { getOrder } from "@/server/services/orders";
import { reviewStateFor } from "@/server/services/reviews";

export const metadata = { title: "Order" };

type Snap = { tier: { name: string; description: string; priceMinor: number; deliveryDays: number; revisions: number }; addons: { name: string; priceMinor: number; extraDays: number }[]; requirements: { seq: number; prompt: string; required: boolean }[] };

const STATUS_HELP: Record<string, string> = {
  pending_payment: "Waiting for the payment provider to confirm payment. Work can't start until then.",
  requirements_pending: "Paid. The buyer needs to answer the seller's questions to start the delivery clock.",
  in_progress: "The seller is working on it.",
  delivered: "Delivered. The buyer can approve or request a revision.",
  revision_requested: "The buyer asked for a revision.",
  release_pending: "Approved. Waiting for the provider to confirm the transfer to the seller.",
  completed: "Completed. Both sides can leave a double-blind review.",
  canceled: "Canceled before payment.",
};

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const actor = await requireActor(`/app/orders/${id}`);
  const db = getDb();
  let d;
  try {
    d = await getOrder(db, actor, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const { order: o, role } = d;
  const snap = o.snapshot as Snap;
  const provider = getPaymentProvider();
  const files = await listAttachments(db, actor, "order_delivery", d.deliveries.map((x) => x.id));
  const review = o.status === "completed" ? await reviewStateFor(db, actor, { kind: "order", id: o.id }) : null;
  const pendingRelease = d.intents.find((i) => i.purpose === "order_release" && (i.status === "requires_action" || i.status === "processing"));
  const idField = <input type="hidden" name="orderId" value={o.id} />;
  return (
    <>
      <PageHeader
        title={o.title}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={o.status} /> You are the {role}. {role === "buyer" ? `Seller: ${d.sellerName}` : `Buyer: ${d.buyerName}`}{d.listingSlug ? <Link className="text-brand underline" href={`/services/${d.listingSlug}`}>service page</Link> : null}</span>}
        actions={(o.snapshot as { paymentMode?: string }).paymentMode === "test" ? <TestModeBadge /> : null}
      />
      {sp.webhook ? <Notice tone={sp.webhook === "applied" ? "success" : "warn"}>Provider webhook processed: {sp.webhook}.</Notice> : null}
      <Notice>{STATUS_HELP[o.status] ?? o.status}</Notice>

      <Card className="grid gap-2 text-sm sm:grid-cols-2">
        <p><span className="text-muted">Package:</span> <span className="capitalize">{o.tier}</span>: {snap.tier.name}</p>
        <p><span className="text-muted">Total:</span> <span className="font-semibold">{formatMoney(o.totalMinor, o.currency)}</span></p>
        <p><span className="text-muted">Delivery time:</span> {o.deliveryDays} days{o.dueAt ? ` · due ${formatDate(o.dueAt)}` : ""}</p>
        <p><span className="text-muted">Revisions:</span> {o.revisionsUsed} of {o.revisionsAllowed} used</p>
        {snap.addons.length ? <p className="sm:col-span-2"><span className="text-muted">Add-ons:</span> {snap.addons.map((a) => `${a.name} (${formatMoney(a.priceMinor, o.currency)})`).join(", ")}</p> : null}
        <p className="sm:col-span-2 text-xs text-muted">{snap.tier.description}</p>
      </Card>

      {role === "buyer" && o.status === "pending_payment" ? (
        <Card className="flex flex-wrap gap-2">
          {provider.configured ? <ActionForm action={orderAction} submitLabel="Pay now" inline>{idField}<input type="hidden" name="op" value="pay" /></ActionForm> : <Notice tone="warn">{provider.unavailableReason ?? "Payments are not configured."}</Notice>}
          <ActionForm action={orderAction} submitLabel="Cancel order" variant="danger" inline confirm="Cancel this unpaid order?">{idField}<input type="hidden" name="op" value="cancel" /></ActionForm>
        </Card>
      ) : null}

      {role === "buyer" && o.status === "requirements_pending" ? (
        <Card>
          <h2 className="mb-2 font-semibold">Requirements</h2>
          <ActionForm action={orderAction} submitLabel="Submit requirements and start order">
            {idField}<input type="hidden" name="op" value="requirements" />
            {snap.requirements.length === 0 ? <p className="text-sm text-muted">The seller didn't ask any questions. Submit to start the delivery clock.</p> : null}
            {snap.requirements.map((r) => (
              <Field key={r.seq} label={`${r.seq}. ${r.prompt}${r.required ? "" : " (optional)"}`} name={`req_${r.seq}`}><Textarea name={`req_${r.seq}`} rows={2} /></Field>
            ))}
          </ActionForm>
        </Card>
      ) : null}
      {role === "seller" && o.status === "requirements_pending" ? <Notice>Waiting for the buyer's requirements.</Notice> : null}

      {d.answers.length ? (
        <Card><h2 className="mb-2 font-semibold">Buyer's answers</h2><dl className="space-y-2 text-sm">{d.answers.map((a) => <div key={a.id}><dt className="text-muted">{a.prompt}</dt><dd className="whitespace-pre-wrap">{a.answer}</dd></div>)}</dl></Card>
      ) : null}

      <Card>
        <h2 className="mb-2 font-semibold">Deliveries</h2>
        {d.deliveries.length === 0 ? <p className="text-sm text-muted">Nothing delivered yet.</p> : (
          <ol className="space-y-3 text-sm">
            {d.deliveries.map((x) => (
              <li key={x.id} className="rounded-md bg-canvas px-3 py-2">
                <p className="text-xs text-muted">Version {x.version} · {formatDate(x.createdAt)}</p>
                <p className="whitespace-pre-wrap">{x.note}</p>
                <FileList files={files.filter((f) => f.entityId === x.id)} />
                {x.revisionNote ? <p className="mt-1 text-warn">Revision requested: {x.revisionNote}</p> : null}
              </li>
            ))}
          </ol>
        )}
        {role === "seller" && (o.status === "in_progress" || o.status === "revision_requested") ? (
          <div className="mt-3 border-t border-line pt-3">
            <ActionForm action={orderAction} submitLabel="Send delivery" pendingLabel="Sending…">
              {idField}<input type="hidden" name="op" value="deliver" />
              <Field label="Delivery note" name="note" hint="Describe what you delivered and how to use it."><Textarea name="note" rows={3} required /></Field>
              <FileInput />
            </ActionForm>
          </div>
        ) : null}
        {role === "buyer" && o.status === "delivered" ? (
          <div className="mt-3 grid gap-4 border-t border-line pt-3 md:grid-cols-2">
            <ActionForm action={orderAction} submitLabel="Approve and release payment" variant="accent" confirm="Approve this delivery? The payment provider will be asked to transfer the funds to the seller.">
              {idField}<input type="hidden" name="op" value="approve" />
              <p className="text-sm text-muted">Approving asks the provider to pay the seller (minus the platform fee frozen at checkout).</p>
            </ActionForm>
            {o.revisionsUsed < o.revisionsAllowed ? (
              <ActionForm action={orderAction} submitLabel="Request revision" variant="secondary">
                {idField}<input type="hidden" name="op" value="revision" />
                <Field label="What should change?" name="note"><Textarea name="note" rows={2} required /></Field>
              </ActionForm>
            ) : <p className="text-sm text-muted">All included revisions are used.</p>}
          </div>
        ) : null}
        {o.status === "release_pending" && pendingRelease && provider.mode === "test" && role === "buyer" ? (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <ActionForm action={simulateOrderProviderAction} submitLabel="Simulate provider: transfer succeeded" variant="accent" inline><input type="hidden" name="intentId" value={pendingRelease.id} /><input type="hidden" name="outcome" value="succeeded" /></ActionForm>
            <ActionForm action={simulateOrderProviderAction} submitLabel="Simulate provider: transfer failed" variant="danger" inline><input type="hidden" name="intentId" value={pendingRelease.id} /><input type="hidden" name="outcome" value="failed" /></ActionForm>
          </div>
        ) : null}
      </Card>

      {review ? (
        <Card className="space-y-3 text-sm">
          <h2 className="text-lg font-semibold">Reviews</h2>
          <p className="text-muted">Double-blind: neither review is visible until both of you submit, or the 14-day window closes.</p>
          {review.mine ? <div><p className="font-semibold">Your review</p><Stars rating={review.mine.rating} /><p className="whitespace-pre-wrap">{review.mine.body}</p>{!review.mine.visibleAt ? <p className="text-xs text-muted">Hidden until the other party reviews or the window closes.</p> : null}</div> : null}
          {review.theirs ? <div><p className="font-semibold">Their review of you</p><Stars rating={review.theirs.rating} /><p className="whitespace-pre-wrap">{review.theirs.body}</p></div> : review.theirsPending ? <p className="text-muted">The other party has left a review. Leave yours to reveal both.</p> : null}
          {review.canReview ? (
            <ActionForm action={reviewAction} submitLabel="Submit review">
              <input type="hidden" name="kind" value="order" /><input type="hidden" name="targetId" value={o.id} />
              <Field label="Rating" name="rating"><Select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}</Select></Field>
              <Field label="Your review" name="body" hint="10–2000 characters."><Textarea name="body" rows={3} required /></Field>
            </ActionForm>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-2 font-semibold">Payments (provider records)</h2>
        {d.intents.length === 0 ? <p className="text-sm text-muted">No payment records.</p> : (
          <ul className="space-y-1 text-sm">{d.intents.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2"><span className="capitalize">{i.purpose.replace(/_/g, " ")}</span> · {formatMoney(Number(i.amount_minor), o.currency)} · <StatusBadge status={i.status} /> <span className="text-xs text-muted">{i.mode} mode · {formatDate(i.created_at)}</span>{role === "buyer" && i.status === "requires_action" && i.purpose === "order_payment" && provider.mode === "test" ? <Link className="text-brand underline" href={`/test-provider/checkout/${i.id}`}>open checkout</Link> : null}</li>)}</ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">History</h2>
        <ul className="space-y-1 text-sm">{d.events.map((e) => <li key={e.id}><span className="text-muted">{formatDate(e.createdAt)}:</span> {e.fromStatus ?? "created"} → {e.toStatus}{e.note ? ` (${e.note})` : ""}</li>)}</ul>
      </Card>
    </>
  );
}
