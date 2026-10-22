import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { requireActor } from "@/lib/session";
import { listMyOrders } from "@/server/services/orders";

export const metadata = { title: "Orders" };

export default async function Orders() {
  const actor = await requireActor("/app/orders");
  const rows = await listMyOrders(getDb(), actor);
  const buying = rows.filter((r) => r.o.buyerId === actor.userId);
  const selling = rows.filter((r) => r.o.sellerId === actor.userId);
  const list = (items: typeof rows, who: "buyer" | "seller") =>
    items.length === 0 ? (
      <EmptyState title={who === "buyer" ? "You haven't ordered any services" : "No orders for your services yet"}>
        {who === "buyer" ? <Link className="text-brand underline" href="/services">Browse the services catalog</Link> : <Link className="text-brand underline" href="/app/services">Manage your services</Link>}
      </EmptyState>
    ) : (
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
        {items.map(({ o, buyerName }) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <Link href={`/app/orders/${o.id}`} className="font-semibold text-ink hover:text-brand">{o.title}</Link>
              <p className="text-xs text-muted capitalize">{o.tier} · {formatMoney(o.totalMinor, o.currency)} · {who === "seller" ? `buyer ${buyerName} · ` : ""}placed {timeAgo(o.createdAt)}</p>
            </div>
            <StatusBadge status={o.status} />
          </li>
        ))}
      </ul>
    );
  return (
    <>
      <PageHeader title="Orders" subtitle="Service orders you bought and sold. Payment and release are confirmed by the payment provider's verified webhooks." />
      <Card className="space-y-2"><h2 className="font-semibold">Buying</h2>{list(buying, "buyer")}</Card>
      <Card className="space-y-2"><h2 className="font-semibold">Selling</h2>{list(selling, "seller")}</Card>
    </>
  );
}
