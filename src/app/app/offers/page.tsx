import Link from "next/link";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { EmptyState, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { requireActor } from "@/lib/session";
import { listMyOffers } from "@/server/services/contracts";

export const metadata = { title: "Offers" };

export default async function Offers() {
  const actor = await requireActor();
  const rows = await listMyOffers(getDb(), actor);
  return (
    <div>
      <PageHeader title="Offers" subtitle="Offers you sent as a client and offers you received as a freelancer." />
      {rows.length === 0 ? <EmptyState title="No offers yet" /> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <Link href={`/app/offers/${o.id}`} className="font-medium hover:text-brand">{o.title}</Link>
                <p className="text-muted">{o.clientId === actor.userId ? "Sent" : "Received"} · {formatMoney(o.totalMinor, o.currency)} · {formatDate(o.createdAt)}</p>
              </div>
              <StatusBadge status={o.status === "sent" && o.expiresAt < new Date() ? "expired" : o.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
