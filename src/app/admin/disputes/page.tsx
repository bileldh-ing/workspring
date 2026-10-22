import { adminAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { NoPermission } from "@/components/admin-bits";
import { Card, EmptyState, Field, PageHeader, StatusBadge, Textarea, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { staffContext } from "@/lib/staff";
import { listDisputesForStaff } from "@/server/services/disputes";

export const metadata = { title: "Disputes" };

export default async function Disputes() {
  const { actor, can } = await staffContext("/admin/disputes");
  if (!can("disputes.resolve")) return <NoPermission perm="disputes.resolve" />;
  const rows = await listDisputesForStaff(getDb(), actor);
  return (
    <>
      <PageHeader title="Disputes" subtitle="Resolve by letting the client release payment, or by refunding through the provider (completes only on the verified refund webhook)." />
      {rows.length === 0 ? <EmptyState title="No disputes" /> : rows.map((r) => (
        <Card key={r.d.id} className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.contractTitle}</span><span className="text-muted">· milestone “{r.milestoneTitle}” · {formatMoney(r.amountMinor, r.currency)} · milestone {r.milestoneStatus.replace(/_/g, " ")}</span><StatusBadge status={r.d.status} /></div>
          <p className="text-xs text-muted">Opened by {r.openedByName} · {formatDate(r.d.createdAt)}</p>
          <p className="whitespace-pre-wrap">{r.d.reason}</p>
          {r.d.resolutionNote ? <p className="text-muted">Resolution: {r.d.resolutionNote}</p> : null}
          {r.d.status === "open" || r.d.status === "under_review" ? (
            <div className="grid gap-3 md:grid-cols-2">
              {(["release", "refund"] as const).map((o) => (
                <ActionForm key={o} action={adminAction} submitLabel={o === "release" ? "Resolve: allow release" : "Resolve: refund client"} variant={o === "release" ? "accent" : "danger"} confirm={o === "refund" ? "Request a refund from the payment provider?" : undefined}>
                  <input type="hidden" name="op" value="resolve_dispute" /><input type="hidden" name="disputeId" value={r.d.id} /><input type="hidden" name="outcome" value={o} />
                  <Field htmlFor={`note-${o}-${r.d.id}`} label="Resolution note (shared with both parties)" name="note"><Textarea name="note" id={`note-${o}-${r.d.id}`} rows={2} /></Field>
                </ActionForm>
              ))}
            </div>
          ) : null}
        </Card>
      ))}
    </>
  );
}
