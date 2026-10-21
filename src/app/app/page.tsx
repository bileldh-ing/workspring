import Link from "next/link";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { Card, EmptyState, LinkButton, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { requireActor } from "@/lib/session";
import { listMyContracts, listMyOffers } from "@/server/services/contracts";
import { listMyJobs } from "@/server/services/jobs";
import { getMyProfile } from "@/server/services/profiles";
import { listMyProposals } from "@/server/services/proposals";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const actor = await requireActor();
  const db = getDb();
  const { welcome } = await searchParams;
  const [contracts, offers] = await Promise.all([listMyContracts(db, actor), listMyOffers(db, actor)]);
  const activeContracts = contracts.filter((c) => c.status === "active");
  const pendingOffers = offers.filter((o) => o.status === "sent" && (actor.activeMode === "freelancer" ? o.freelancerId === actor.userId : o.clientId === actor.userId));

  if (actor.activeMode === "client") {
    const jobs = await listMyJobs(db, actor);
    return (
      <div className="space-y-6">
        <PageHeader title={`Welcome, ${actor.displayName}`} subtitle="Client workspace" actions={<LinkButton href="/app/jobs/new">Post a job</LinkButton>} />
        {welcome ? <Notice tone="success">Account created. Verify your email, then post your first job.</Notice> : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Card><p className="text-sm text-muted">Open jobs</p><p className="text-2xl font-bold">{jobs.filter((j) => j.status === "open").length}</p></Card>
          <Card><p className="text-sm text-muted">Proposals received</p><p className="text-2xl font-bold">{jobs.reduce((a, j) => a + j.proposal_count, 0)}</p></Card>
          <Card><p className="text-sm text-muted">Active contracts</p><p className="text-2xl font-bold">{activeContracts.length}</p></Card>
        </div>
        <section>
          <h2 className="mb-2 font-semibold">Your jobs</h2>
          {jobs.length === 0 ? <EmptyState title="No jobs yet"><Link className="text-brand underline" href="/app/jobs/new">Post your first job</Link></EmptyState> : (
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
              {jobs.slice(0, 6).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <Link href={`/app/jobs/${j.id}`} className="font-medium hover:text-brand">{j.title}</Link>
                  <span className="flex items-center gap-3 text-muted">{j.proposal_count} proposals <StatusBadge status={j.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <ContractList contracts={activeContracts} />
      </div>
    );
  }

  const [profile, proposals] = await Promise.all([getMyProfile(db, actor), listMyProposals(db, actor)]);
  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${actor.displayName}`} subtitle="Freelancer workspace" actions={<LinkButton href="/jobs">Find work</LinkButton>} />
      {!profile ? <Notice title="Create your profile">You need a published profile before sending proposals. <Link href="/app/profile" className="underline">Start your profile</Link>.</Notice>
        : profile.status !== "published" ? <Notice tone="warn">Your profile is {profile.status}. <Link href="/app/profile" className="underline">Publish it</Link> to apply to jobs.</Notice> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm text-muted">Active proposals</p><p className="text-2xl font-bold">{proposals.filter((p) => ["submitted", "shortlisted", "offer_sent"].includes(p.p.status)).length}</p></Card>
        <Card><p className="text-sm text-muted">Offers awaiting you</p><p className="text-2xl font-bold">{pendingOffers.length}</p></Card>
        <Card><p className="text-sm text-muted">Active contracts</p><p className="text-2xl font-bold">{activeContracts.length}</p></Card>
      </div>
      {pendingOffers.length > 0 ? (
        <section>
          <h2 className="mb-2 font-semibold">Offers awaiting your answer</h2>
          <ul className="space-y-2">{pendingOffers.map((o) => <li key={o.id}><Card className="flex items-center justify-between text-sm"><Link href={`/app/offers/${o.id}`} className="font-medium hover:text-brand">{o.title}</Link><span>{formatMoney(o.totalMinor, o.currency)}</span></Card></li>)}</ul>
        </section>
      ) : null}
      <ContractList contracts={activeContracts} />
    </div>
  );
}

function ContractList({ contracts }: { contracts: { id: string; title: string; status: string; totalMinor: number; currency: string }[] }) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">Active contracts</h2>
      {contracts.length === 0 ? <EmptyState title="No active contracts" /> : (
        <ul className="space-y-2">{contracts.map((c) => <li key={c.id}><Card className="flex items-center justify-between text-sm"><Link href={`/app/contracts/${c.id}`} className="font-medium hover:text-brand">{c.title}</Link><span className="flex items-center gap-2">{formatMoney(c.totalMinor, c.currency)} <StatusBadge status={c.status} /></span></Card></li>)}</ul>
      )}
    </section>
  );
}
