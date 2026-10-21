import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { budgetText, LEVEL_LABELS, SCOPE_LABELS } from "@/components/labels";
import { Card, DemoBadge, LinkButton, Notice, StatusBadge, Tag, formatDate } from "@/components/ui";
import { getActor } from "@/lib/session";
import { getPublicJob } from "@/server/services/jobs";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const job = await getPublicJob(getDb(), (await params).slug);
  return { title: job ? job.title : "Job not found", description: job?.description.slice(0, 150) };
}

export default async function JobDetail({ params }: { params: Promise<{ slug: string }> }) {
  const job = await getPublicJob(getDb(), (await params).slug);
  if (!job) notFound();
  const actor = await getActor();
  const isOwner = actor?.userId === job.clientId;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_300px]">
      <article className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={job.status} />
          {job.isDemo ? <DemoBadge /> : null}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{job.title}</h1>
        <p className="text-sm text-muted">
          Posted {formatDate(job.publishedAt)} · {job.categoryName ?? "Uncategorised"} · {job.proposalCount} proposal{job.proposalCount === 1 ? "" : "s"}
        </p>
        {job.status !== "open" ? <Notice tone="warn">This job is not accepting proposals.</Notice> : null}
        <Card>
          <h2 className="font-semibold">Description</h2>
          <div className="prose-ws text-sm text-ink-soft"><p>{job.description}</p></div>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Skills</h2>
          <div className="flex flex-wrap gap-1.5">{job.skills.map((s) => <Tag key={s.slug}>{s.name}</Tag>)}</div>
        </Card>
      </article>
      <aside className="space-y-4">
        <Card className="space-y-2 text-sm">
          <p className="font-semibold text-ink">{budgetText({ contract_type: job.contractType, budget_min_minor: job.budgetMinMinor, budget_max_minor: job.budgetMaxMinor, currency: job.currency })}</p>
          <p className="text-muted">{LEVEL_LABELS[job.experienceLevel]}</p>
          <p className="text-muted">{SCOPE_LABELS[job.scope]}</p>
          {job.locationNote ? <p className="text-muted">Location: {job.locationNote}</p> : null}
          <p className="text-muted">Client: {job.clientName}</p>
          <p className="text-xs text-muted">Budgets are indicative; binding terms are set in the offer.</p>
        </Card>
        {job.status === "open" && !isOwner ? (
          <LinkButton href={actor ? `/app/apply/${job.id}` : `/signin?next=${encodeURIComponent(`/app/apply/${job.id}`)}`} className="w-full">
            {actor ? "Submit a proposal" : "Sign in to apply"}
          </LinkButton>
        ) : null}
        {isOwner ? <LinkButton href={`/app/jobs/${job.id}`} variant="secondary" className="w-full">Manage this job</LinkButton> : null}
      </aside>
    </div>
  );
}
