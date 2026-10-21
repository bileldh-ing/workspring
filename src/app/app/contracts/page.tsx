import Link from "next/link";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { EmptyState, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { requireActor } from "@/lib/session";
import { listMyContracts } from "@/server/services/contracts";

export const metadata = { title: "Contracts" };

export default async function Contracts() {
  const actor = await requireActor();
  const rows = await listMyContracts(getDb(), actor);
  return (
    <div>
      <PageHeader title="Contracts" />
      {rows.length === 0 ? <EmptyState title="No contracts yet">A contract starts when a freelancer accepts an offer.</EmptyState> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <Link href={`/app/contracts/${c.id}`} className="font-medium hover:text-brand">{c.title}</Link>
                <p className="text-muted">{c.clientId === actor.userId ? "You are the client" : "You are the freelancer"} · {formatMoney(c.totalMinor, c.currency)} · started {formatDate(c.startedAt)}</p>
              </div>
              <StatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
