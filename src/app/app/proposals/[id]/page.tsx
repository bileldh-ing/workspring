import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { createOfferAction, openConversationAction, reviewProposalAction, withdrawProposalAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { DURATION_LABELS } from "@/components/labels";
import { Card, Field, Input, Notice, PageHeader, StatusBadge, Textarea, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { conversations, offers } from "@/db/schema";
import { isAppError } from "@/domain/errors";
import { formatMoney, isCurrency, minorToDecimal } from "@/domain/money";
import { requireActor } from "@/lib/session";
import { getProposal } from "@/server/services/proposals";
import { scheduleInterviewAction } from "@/app/actions/r2";
import { AttachForm, FileList, ReportForm } from "@/components/r2";
import { TzOffsetInput } from "@/components/tz-offset";
import { listAttachments } from "@/server/services/files";

export const metadata = { title: "Proposal" };

export default async function ProposalDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { submitted } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  let data;
  try {
    data = await getProposal(db, actor, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const { p, job, viewerRole } = data;
  const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.proposalId, p.id));
  const [pendingOffer] = await db.select({ id: offers.id }).from(offers).where(and(eq(offers.proposalId, p.id), eq(offers.status, "sent")));
  const canOffer = viewerRole === "client" && ["submitted", "shortlisted"].includes(p.status) && job.status !== "closed" && job.contractType === "fixed";
  const canHourlyOffer = viewerRole === "client" && ["submitted", "shortlisted"].includes(p.status) && job.status !== "closed" && job.contractType === "hourly";
  const files = await listAttachments(db, actor, "proposal", [p.id]);
  const amountDefault = isCurrency(p.currency) ? minorToDecimal(p.amountMinor, p.currency) : "";
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={viewerRole === "client" ? `Proposal from ${data.freelancerName}` : "Your proposal"}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={p.status} /> for <Link href={`/jobs/${job.slug}`} className="text-brand hover:underline">{job.title}</Link></span>}
      />
      {submitted ? <Notice tone="success">Proposal sent. The client will see it in their proposals list.</Notice> : null}
      <Card className="space-y-2 text-sm">
        <p><span className="text-muted">Terms:</span> <strong>{formatMoney(p.amountMinor, p.currency)}{p.rateType === "hourly" ? "/hr" : " fixed"}</strong> · {DURATION_LABELS[p.durationEstimate]}</p>
        <p className="text-muted">Submitted {formatDate(p.submittedAt)}</p>
        {viewerRole === "client" && data.freelancerSlug ? <p><Link href={`/freelancers/${data.freelancerSlug}`} className="text-brand hover:underline">View {data.freelancerName}&apos;s profile</Link> · {data.freelancerTitle}</p> : null}
        <h2 className="pt-2 font-semibold text-ink">Cover letter</h2>
        <div className="prose-ws text-ink-soft"><p>{p.coverLetter}</p></div>
        {p.declineReason ? <p className="text-danger">Decline reason: {p.declineReason}</p> : null}
        {data.answers.length ? (
          <div className="pt-2">
            <h2 className="font-semibold text-ink">Screening answers</h2>
            <dl className="mt-1 space-y-2">
              {data.answers.map((a) => (
                <div key={a.id}><dt className="font-medium text-ink-soft">{a.prompt}</dt><dd className="whitespace-pre-wrap text-ink">{a.answer}</dd></div>
              ))}
            </dl>
          </div>
        ) : null}
        <div className="pt-2">
          <h2 className="font-semibold text-ink">Attachments</h2>
          {files.length ? <FileList files={files} /> : <p className="text-muted">No attachments.</p>}
        </div>
      </Card>
      {viewerRole === "freelancer" && ["submitted", "shortlisted"].includes(p.status) ? (
        <details className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Add attachments</summary>
          <div className="mt-3"><AttachForm entityType="proposal" entityId={p.id} back={`/app/proposals/${p.id}`} /></div>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {conv ? <Link href={`/app/messages/${conv.id}`} className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-4 py-2 text-sm font-semibold">Open conversation</Link> : null}
        {pendingOffer ? <Link href={`/app/offers/${pendingOffer.id}`} className="rounded-[var(--radius-control)] bg-brand px-4 py-2 text-sm font-semibold text-white">View pending offer</Link> : null}
      </div>

      {viewerRole === "client" ? (
        <Card className="flex flex-wrap items-start gap-3">
          {!conv && p.status !== "withdrawn" ? (
            <ActionForm action={openConversationAction} submitLabel="Message freelancer" variant="secondary" inline>
              <input type="hidden" name="proposalId" value={p.id} />
            </ActionForm>
          ) : null}
          {p.status === "submitted" ? (
            <ActionForm action={reviewProposalAction} submitLabel="Shortlist" variant="secondary" inline>
              <input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="op" value="shortlist" />
            </ActionForm>
          ) : null}
          {p.status === "shortlisted" ? (
            <ActionForm action={reviewProposalAction} submitLabel="Remove from shortlist" variant="ghost" inline>
              <input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="op" value="unshortlist" />
            </ActionForm>
          ) : null}
          {["submitted", "shortlisted"].includes(p.status) ? (
            <ActionForm action={reviewProposalAction} submitLabel="Decline" variant="danger" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="op" value="decline" />
              <Field label="Reason (optional, shown to the freelancer)" name="reason"><Input name="reason" maxLength={500} /></Field>
            </ActionForm>
          ) : null}
        </Card>
      ) : null}

      {viewerRole === "client" && ["submitted", "shortlisted", "offer_sent"].includes(p.status) ? (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Schedule an interview</h2>
          <p className="mb-3 text-sm text-muted">Times are entered in your browser&apos;s time zone and stored in UTC. The freelancer confirms or declines. Video rooms open only when a video provider is configured.</p>
          <ActionForm action={scheduleInterviewAction} submitLabel="Propose interview" variant="secondary">
            <input type="hidden" name="proposalId" value={p.id} />
            <TzOffsetInput />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date and time (your local time)" name="startsAtLocal"><Input name="startsAtLocal" type="datetime-local" required /></Field>
              <Field label="Duration (minutes)" name="durationMinutes"><Input name="durationMinutes" type="number" min={15} max={180} step={15} defaultValue={30} /></Field>
            </div>
            <Field label="Agenda (optional)" name="agenda"><Textarea name="agenda" rows={2} maxLength={1000} /></Field>
          </ActionForm>
        </Card>
      ) : null}

      {viewerRole === "freelancer" && ["submitted", "shortlisted"].includes(p.status) ? (
        <ActionForm action={withdrawProposalAction} submitLabel="Withdraw proposal" variant="danger" confirm="Withdraw this proposal?">
          <input type="hidden" name="proposalId" value={p.id} />
        </ActionForm>
      ) : null}

      {canOffer ? (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Send a fixed-price offer</h2>
          <p className="mb-4 text-sm text-muted">The freelancer must accept explicitly. Accepted terms are frozen as a snapshot. The offer expires after 14 days.</p>
          <ActionForm action={createOfferAction} submitLabel="Send offer" pendingLabel="Sending…">
            <input type="hidden" name="proposalId" value={p.id} />
            <Field label="Contract title" name="title"><Input name="title" defaultValue={job.title} required /></Field>
            <Field label="Scope and deliverables" name="description"><Textarea name="description" rows={4} required /></Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Milestones ({p.currency}); leave unused rows empty</legend>
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_140px_160px]">
                  <Input name="msTitle" aria-label={`Milestone ${i + 1} title`} placeholder={`Milestone ${i + 1} title`} defaultValue={i === 0 ? "Complete project" : ""} />
                  <Input name="msAmount" aria-label={`Milestone ${i + 1} amount`} placeholder="Amount" inputMode="decimal" defaultValue={i === 0 ? amountDefault : ""} />
                  <Input name="msDue" aria-label={`Milestone ${i + 1} due date`} type="date" />
                </div>
              ))}
            </fieldset>
          </ActionForm>
        </Card>
      ) : canHourlyOffer ? (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Send an hourly offer</h2>
          <p className="mb-4 text-sm text-muted">The weekly limit caps billable hours. The freelancer logs time with the web timer (and manual entries if you allow them) and submits weekly timesheets for your approval.</p>
          <ActionForm action={createOfferAction} submitLabel="Send offer" pendingLabel="Sending…">
            <input type="hidden" name="proposalId" value={p.id} />
            <Field label="Contract title" name="title"><Input name="title" defaultValue={job.title} required /></Field>
            <Field label="Scope and deliverables" name="description"><Textarea name="description" rows={4} required /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Hourly rate (${p.currency})`} name="hourlyRate"><Input name="hourlyRate" inputMode="decimal" defaultValue={amountDefault} required /></Field>
              <Field label="Weekly limit (hours)" name="weeklyLimitHours"><Input name="weeklyLimitHours" type="number" min={1} max={80} defaultValue={10} required /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowManualTime" /> Allow manual time entries (labelled “manual” to both parties)</label>
          </ActionForm>
        </Card>
      ) : null}

      {viewerRole === "client" ? <ReportForm targetType="user" targetId={p.freelancerId} label="Report this freelancer" /> : null}

      <section>
        <h2 className="mb-2 font-semibold">Status history</h2>
        <ol className="space-y-1 text-sm text-muted">
          {data.events.map((e) => <li key={e.id}>{formatDate(e.createdAt)}: {e.fromStatus ?? "new"} → {e.toStatus}{e.note ? ` (${e.note})` : ""}</li>)}
        </ol>
      </section>
    </div>
  );
}
