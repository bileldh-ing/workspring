import Link from "next/link";
import { interviewAction, joinInterviewAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Notice, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/session";
import { listMyInterviews } from "@/server/services/interviews";
import { videoConfig } from "@/server/video/livekit";

export const metadata = { title: "Interviews" };

function Btn({ id, to, label, variant = "secondary" }: { id: string; to: string; label: string; variant?: "secondary" | "danger" | "accent" }) {
  return (
    <ActionForm action={interviewAction} submitLabel={label} variant={variant} inline>
      <input type="hidden" name="interviewId" value={id} />
      <input type="hidden" name="to" value={to} />
    </ActionForm>
  );
}

export default async function Interviews({ searchParams }: { searchParams: Promise<{ scheduled?: string }> }) {
  const actor = await requireActor("/app/interviews");
  const { scheduled } = await searchParams;
  const rows = await listMyInterviews(getDb(), actor);
  const video = !!videoConfig();
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Interviews" subtitle="All times are shown in UTC. Download the calendar file to see them in your own time zone." />
      {scheduled ? <Notice tone="success">Interview proposed. The freelancer will be notified to confirm.</Notice> : null}
      {!video ? <Notice title="Video calls are not configured on this server">Interviews can be scheduled, confirmed and added to calendars. The built-in video room needs a LiveKit project (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET); until then, agree on a meeting tool in messages.</Notice> : null}
      {rows.length === 0 ? <EmptyState title="No interviews yet">Clients can schedule an interview from any proposal.</EmptyState> : (
        <ul className="space-y-3">
          {rows.map((iv) => (
            <li key={iv.id}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{iv.jobTitle}</p>
                  <StatusBadge status={iv.status} />
                </div>
                <p className="text-sm text-muted">With {iv.otherName} · {formatDate(iv.startsAt)} · {iv.durationMinutes} min · <Link href={`/app/proposals/${iv.proposalId}`} className="text-brand hover:underline">proposal</Link></p>
                {iv.agenda ? <p className="text-sm text-ink-soft">{iv.agenda}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/api/interviews/${iv.id}/ics`} className="text-sm font-semibold text-brand hover:underline">Add to calendar (.ics)</a>
                  {iv.status === "proposed" && iv.role === "freelancer" ? <><Btn id={iv.id} to="confirmed" label="Confirm" variant="accent" /><Btn id={iv.id} to="declined" label="Decline" variant="danger" /></> : null}
                  {(iv.status === "proposed" || iv.status === "confirmed") ? <Btn id={iv.id} to="canceled" label="Cancel" variant="danger" /> : null}
                  {iv.status === "confirmed" && iv.role === "client" ? <Btn id={iv.id} to="completed" label="Mark completed" /> : null}
                  {iv.status === "confirmed" ? (
                    <ActionForm action={joinInterviewAction} submitLabel="Join video room" variant="secondary" inline>
                      <input type="hidden" name="interviewId" value={iv.id} />
                    </ActionForm>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
