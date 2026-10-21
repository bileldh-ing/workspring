import Link from "next/link";
import { notFound } from "next/navigation";
import { transitionJobAction, updateJobAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { JobFields } from "@/components/job-form";
import { budgetText, DURATION_LABELS } from "@/components/labels";
import { Card, EmptyState, Notice, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { formatMoney, isCurrency, minorToDecimal } from "@/domain/money";
import { jobMachine } from "@/domain/state-machines";
import { requireActor } from "@/lib/session";
import { getOwnedJob } from "@/server/services/jobs";
import { listJobProposals } from "@/server/services/proposals";
import { listCategories, listSkills } from "@/server/services/taxonomy";

export const metadata = { title: "Manage job" };
const LABEL: Record<string, string> = { open: "Publish", paused: "Pause", closed: "Close job" };

export default async function ManageJob({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { created } = await searchParams;
  const db = getDb();
  let job;
  try {
    job = await getOwnedJob(db, actor, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const [proposals, categories, skills] = await Promise.all([listJobProposals(db, actor, id), listCategories(db), listSkills(db)]);
  const dec = (v: number | null) => (v !== null && isCurrency(job.currency) ? minorToDecimal(v, job.currency) : "");
  const transitions = jobMachine[job.status];
  return (
    <div className="space-y-6">
      <PageHeader
        title={job.title}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={job.status} /> {budgetText({ contract_type: job.contractType, budget_min_minor: job.budgetMinMinor, budget_max_minor: job.budgetMaxMinor, currency: job.currency })}</span>}
        actions={job.status !== "draft" ? <Link className="text-sm font-semibold text-brand hover:underline" href={`/jobs/${job.slug}`}>View public page →</Link> : null}
      />
      {created ? <Notice tone="success">Draft saved. Review it below, then publish when ready.</Notice> : null}
      <Card className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">Status actions:</span>
        {transitions.length === 0 ? <span className="text-sm text-muted">Closed jobs can&apos;t be changed.</span> : null}
        {transitions.map((to) => (
          <ActionForm key={to} action={transitionJobAction} submitLabel={job.status === "paused" && to === "open" ? "Reopen" : LABEL[to]} variant={to === "closed" ? "danger" : to === "open" ? "accent" : "secondary"} inline confirm={to === "closed" ? "Close this job? It will stop accepting proposals and can't be reopened." : undefined}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="to" value={to} />
          </ActionForm>
        ))}
      </Card>

      <section aria-labelledby="proposals-h">
        <h2 id="proposals-h" className="mb-2 text-lg font-semibold">Proposals ({proposals.length})</h2>
        {proposals.length === 0 ? <EmptyState title="No proposals yet">{job.status === "open" ? "Published jobs appear in search; proposals will show up here." : "Publish the job to start receiving proposals."}</EmptyState> : (
          <ul className="space-y-2">
            {proposals.map((r) => (
              <li key={r.p.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link href={`/app/proposals/${r.p.id}`} className="font-semibold hover:text-brand">{r.freelancerName}</Link>
                    <p className="text-sm text-muted">{r.freelancerTitle} · {formatMoney(r.p.amountMinor, r.p.currency)}{r.p.rateType === "hourly" ? "/hr" : " fixed"} · {DURATION_LABELS[r.p.durationEstimate]} · {formatDate(r.p.submittedAt)}</p>
                  </div>
                  <StatusBadge status={r.p.status} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {job.status !== "closed" ? (
        <details className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <summary className="cursor-pointer font-semibold">Edit job post</summary>
          <div className="mt-4">
            <ActionForm action={updateJobAction} submitLabel="Save changes">
              <input type="hidden" name="jobId" value={job.id} />
              <JobFields categories={categories} skills={skills} d={{ title: job.title, description: job.description, categorySlug: job.categorySlug, skills: job.skills.map((s) => s.slug), contractType: job.contractType, currency: job.currency, budgetMin: dec(job.budgetMinMinor), budgetMax: dec(job.budgetMaxMinor), scope: job.scope, experienceLevel: job.experienceLevel, locationNote: job.locationNote ?? "" }} />
            </ActionForm>
          </div>
        </details>
      ) : null}

      <section>
        <h2 className="mb-2 text-lg font-semibold">History</h2>
        <ol className="space-y-1 text-sm text-muted">
          {job.events.map((e) => <li key={e.id}>{formatDate(e.createdAt)}: {e.fromStatus ?? "created"} → {e.toStatus}</li>)}
        </ol>
      </section>
    </div>
  );
}
