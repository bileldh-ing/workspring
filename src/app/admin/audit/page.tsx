import { NoPermission } from "@/components/admin-bits";
import { Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { staffContext } from "@/lib/staff";
import { auditTrail } from "@/server/services/admin";

export const metadata = { title: "Audit log" };

export default async function Audit() {
  const { actor, can } = await staffContext("/admin/audit");
  if (!can("audit.read")) return <NoPermission perm="audit.read" />;
  const rows = await auditTrail(getDb(), actor);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of sensitive and staff actions (latest 200)." />
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <EmptyState title="No audit entries" /> : (
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-line"><th className="py-1 pr-2">When</th><th className="pr-2">Actor</th><th className="pr-2">Action</th><th className="pr-2">Entity</th><th>Data</th></tr></thead>
            <tbody>{rows.map(({ a, actorName }) => <tr key={a.id} className="border-b border-line align-top"><td className="py-1 pr-2 whitespace-nowrap">{formatDate(a.createdAt)}</td><td className="pr-2">{actorName ?? "system"}</td><td className="pr-2 font-mono">{a.action}</td><td className="pr-2">{a.entityType} <code>{String(a.entityId ?? "").slice(0, 8)}</code></td><td className="max-w-xs truncate font-mono" title={JSON.stringify(a.data)}>{a.data ? JSON.stringify(a.data) : ""}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
