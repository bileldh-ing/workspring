import { adminAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { NoPermission } from "@/components/admin-bits";
import { Card, DoneNotice, EmptyState, Input, PageHeader, Select, StatusBadge, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { staffContext } from "@/lib/staff";
import { listReports } from "@/server/services/admin";

export const metadata = { title: "Reports" };

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, can } = await staffContext("/admin/reports");
  if (!can("reports.handle")) return <NoPermission perm="reports.handle" />;
  const rows = await listReports(getDb(), actor);
  const { done } = await searchParams;
  return (
    <>
      <DoneNotice done={done} messages={{ reviewing: "Report marked as under review.", actioned: "Report closed as actioned. The reporter was notified.", dismissed: "Report dismissed. The reporter was notified." }} />
      <PageHeader title="Abuse reports" subtitle="Reporter identity and details are visible to authorized staff only." />
      {rows.length === 0 ? <EmptyState title="No reports" /> : rows.map(({ r, reporterName }) => (
        <Card key={r.id} className="space-y-1 text-sm" data-testid="report-item">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold capitalize">{r.reason.replace(/_/g, " ")}</span><span className="text-muted">on {r.targetType} <code className="text-xs">{r.targetId.slice(0, 8)}…</code> · by {reporterName} · {formatDate(r.createdAt)}</span><StatusBadge status={r.status} /></div>
          {r.details ? <p className="whitespace-pre-wrap text-ink-soft">{r.details}</p> : null}
          {r.resolutionNote ? <p className="text-muted">Resolution: {r.resolutionNote}</p> : null}
          {r.status === "open" || r.status === "reviewing" ? (
            <ActionForm action={adminAction} submitLabel="Update report" variant="secondary" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="op" value="report" /><input type="hidden" name="reportId" value={r.id} />
              <Select name="status" aria-label="New status" defaultValue={r.status === "open" ? "reviewing" : "actioned"} className="w-40"><option value="reviewing">Reviewing</option><option value="actioned">Actioned</option><option value="dismissed">Dismissed</option></Select>
              <Input name="note" aria-label="Resolution note" placeholder="Resolution note" className="w-64" />
            </ActionForm>
          ) : null}
        </Card>
      ))}
    </>
  );
}
