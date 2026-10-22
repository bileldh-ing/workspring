import Link from "next/link";
import { invitationResponseAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Field, Input, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/session";
import { listInvitations } from "@/server/services/invitations";

export const metadata = { title: "Invitations" };

export default async function Invitations() {
  const actor = await requireActor("/app/invitations");
  const rows = await listInvitations(getDb(), actor);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Invitations to apply" subtitle="Clients who invited you to their jobs. Applying accepts the invitation." />
      {rows.length === 0 ? <EmptyState title="No invitations yet">When a client invites you to a job, it appears here and in your notifications.</EmptyState> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.inv.id}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/jobs/${r.jobSlug}`} className="font-semibold hover:text-brand">{r.jobTitle}</Link>
                  <StatusBadge status={r.effectiveStatus} />
                </div>
                <p className="text-sm text-muted">From {r.clientName} · {formatDate(r.inv.createdAt)} · expires {formatDate(r.inv.expiresAt)}</p>
                <p className="whitespace-pre-wrap text-sm text-ink-soft">{r.inv.message}</p>
                {r.effectiveStatus === "sent" ? (
                  <div className="flex flex-wrap items-end gap-3">
                    {r.jobStatus === "open" ? <Link href={`/app/apply/${r.jobId}`} className="rounded-[var(--radius-control)] bg-brand px-4 py-2 text-sm font-semibold text-white">Apply now</Link> : <span className="text-sm text-muted">This job is no longer open.</span>}
                    <ActionForm action={invitationResponseAction} submitLabel="Decline" variant="danger" className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="invitationId" value={r.inv.id} />
                      <input type="hidden" name="op" value="decline" />
                      <Field htmlFor={`reason-${r.inv.id}`} label="Reason (optional)" name="reason"><Input name="reason" id={`reason-${r.inv.id}`} maxLength={500} /></Field>
                    </ActionForm>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
