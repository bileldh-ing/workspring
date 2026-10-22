import Link from "next/link";
import { NoPermission } from "@/components/admin-bits";
import { EmptyState, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { getDb } from "@/db/client";
import { staffContext } from "@/lib/staff";
import { supportQueue } from "@/server/services/support";

export const metadata = { title: "Support queue" };

export default async function SupportQueue() {
  const { actor, can } = await staffContext("/admin/support");
  if (!can("support.handle")) return <NoPermission perm="support.handle" />;
  const rows = await supportQueue(getDb(), actor);
  return (
    <>
      <PageHeader title="Support queue" subtitle="Oldest first. Opening a ticket as staff is recorded in the audit log." />
      {rows.length === 0 ? <EmptyState title="No open tickets" /> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map(({ t, userName }) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div><Link href={`/admin/support/${t.id}`} className="font-semibold text-ink hover:text-brand">{t.subject}</Link><p className="text-xs text-muted"><span className="capitalize">{t.category}</span> · {userName} · updated {timeAgo(t.updatedAt)}</p></div>
              <StatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
