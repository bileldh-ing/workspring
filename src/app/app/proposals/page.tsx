import Link from "next/link";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { EmptyState, Notice, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { requireActor } from "@/lib/session";
import { listMyProposals } from "@/server/services/proposals";

export const metadata = { title: "Proposals" };
const FILTERS = ["", "submitted", "shortlisted", "offer_sent", "hired", "declined", "withdrawn"] as const;

export default async function MyProposals({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  if (!actor.capabilities.includes("freelancer")) return <Notice>Proposals are sent from a freelancer account. Add the capability in <Link href="/app/settings" className="underline">Settings</Link>.</Notice>;
  const { status } = await searchParams;
  const st = FILTERS.includes((status ?? "") as (typeof FILTERS)[number]) ? (status as (typeof FILTERS)[number]) : "";
  const rows = await listMyProposals(getDb(), actor, st || undefined);
  return (
    <div>
      <PageHeader title="Your proposals" />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f || "all"} href={f ? `/app/proposals?status=${f}` : "/app/proposals"} aria-current={st === f ? "page" : undefined} className={`rounded-full border px-3 py-1 capitalize ${st === f ? "border-brand bg-brand-soft text-brand" : "border-line-strong text-ink-soft"}`}>
            {f ? f.replace("_", " ") : "All"}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? <EmptyState title="No proposals here"><Link href="/jobs" className="text-brand underline">Find work</Link></EmptyState> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <Link href={`/app/proposals/${r.p.id}`} className="font-medium hover:text-brand">{r.jobTitle}</Link>
                <p className="text-muted">{formatMoney(r.p.amountMinor, r.p.currency)}{r.p.rateType === "hourly" ? "/hr" : ""} · sent {formatDate(r.p.submittedAt)}</p>
              </div>
              <StatusBadge status={r.p.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
