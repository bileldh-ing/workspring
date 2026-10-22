import Link from "next/link";
import { EmptyState, LinkButton, Notice, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/session";
import { listMyServices } from "@/server/services/catalog";

export const metadata = { title: "My services" };

export default async function MyServices() {
  const actor = await requireActor("/app/services");
  if (!actor.capabilities.includes("freelancer")) {
    return <><PageHeader title="My services" /><Notice tone="warn">Selling services needs freelancer capability. Add it from <Link className="underline" href="/app/settings">Settings</Link>.</Notice></>;
  }
  const rows = await listMyServices(getDb(), actor);
  return (
    <>
      <PageHeader title="My services" subtitle="Packaged offers buyers can order directly. Each listing is reviewed by a moderator before it is published." actions={<LinkButton href="/app/services/new">New service</LinkButton>} />
      {rows.length === 0 ? (
        <EmptyState title="No services yet">Create a draft, then submit it for review.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <Link href={`/app/services/${s.id}`} className="font-semibold text-ink hover:text-brand">{s.title}</Link>
                <p className="text-xs text-muted">updated {timeAgo(s.updatedAt)}{s.status === "published" ? <> · <Link className="text-brand underline" href={`/services/${s.slug}`}>public page</Link></> : null}</p>
              </div>
              <StatusBadge status={s.status} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm"><Link href="/app/orders" className="font-semibold text-brand hover:underline">View orders →</Link></p>
    </>
  );
}
