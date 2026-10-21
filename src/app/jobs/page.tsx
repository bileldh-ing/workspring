import Link from "next/link";
import { getDb } from "@/db/client";
import { jobSearchSchema } from "@/domain/validation";
import { budgetText, LEVEL_LABELS } from "@/components/labels";
import { Pagination } from "@/components/pagination";
import { buttonClass, Card, DemoBadge, EmptyState, Input, PageHeader, Select, Tag, timeAgo } from "@/components/ui";
import { searchJobs } from "@/server/services/jobs";
import { listCategories, listSkills } from "@/server/services/taxonomy";

export const metadata = { title: "Find work" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;


export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const parsed = jobSearchSchema.safeParse(sp);
  const params = parsed.success ? parsed.data : jobSearchSchema.parse({});
  const db = getDb();
  const [result, cats, skills] = await Promise.all([searchJobs(db, params), listCategories(db), listSkills(db)]);
  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <aside>
        <form method="get" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4" role="search" aria-label="Filter jobs">
          <label className="block text-sm font-medium" htmlFor="q">Keywords</label>
          <Input id="q" name="q" defaultValue={params.q} placeholder="e.g. react dashboard" />
          <label className="block text-sm font-medium" htmlFor="category">Category</label>
          <Select id="category" name="category" defaultValue={params.category}>
            <option value="">Any category</option>
            {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </Select>
          <label className="block text-sm font-medium" htmlFor="skill">Skill</label>
          <Select id="skill" name="skill" defaultValue={params.skill}>
            <option value="">Any skill</option>
            {skills.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
          </Select>
          <label className="block text-sm font-medium" htmlFor="type">Contract type</label>
          <Select id="type" name="type" defaultValue={params.type}>
            <option value="">Any</option>
            <option value="fixed">Fixed price</option>
            <option value="hourly">Hourly</option>
          </Select>
          <label className="block text-sm font-medium" htmlFor="level">Experience level</label>
          <Select id="level" name="level" defaultValue={params.level}>
            <option value="">Any</option>
            {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <label className="block text-sm font-medium" htmlFor="minBudget">Minimum budget (USD/EUR major units)</label>
          <Input id="minBudget" name="minBudget" type="number" min={0} defaultValue={params.minBudget ?? ""} />
          <label className="block text-sm font-medium" htmlFor="sort">Sort by</label>
          <Select id="sort" name="sort" defaultValue={params.sort}>
            <option value="relevance">Relevance</option>
            <option value="newest">Newest</option>
            <option value="budget_desc">Highest budget</option>
          </Select>
          <div className="flex gap-2 pt-1">
            <button className={buttonClass("primary")}>Apply filters</button>
            <Link href="/jobs" className={buttonClass("ghost")}>Reset</Link>
          </div>
          {!parsed.success ? <p className="text-xs text-danger" role="alert">Some filters were invalid and were ignored.</p> : null}
        </form>
      </aside>
      <section aria-labelledby="results-heading">
        <PageHeader title="Find work" subtitle={<span id="results-heading">{result.total} open job{result.total === 1 ? "" : "s"} match</span>} />
        {result.results.length === 0 ? (
          <EmptyState title="No jobs match these filters">Try fewer filters or different keywords.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {result.results.map((j) => (
              <li key={j.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="text-lg font-semibold">
                      <Link href={`/jobs/${j.slug}`} className="text-ink hover:text-brand">{j.title}</Link>
                    </h2>
                    {j.is_demo ? <DemoBadge /> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {budgetText(j)} · {LEVEL_LABELS[j.experience_level]} · {j.category_name ?? "Uncategorised"} · posted {timeAgo(j.published_at)} · {j.proposal_count} proposal{j.proposal_count === 1 ? "" : "s"}
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm text-ink-soft">{j.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">{j.skills.map((s) => <Tag key={s.slug}>{s.name}</Tag>)}</div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} base="/jobs" params={{ ...sp, page: undefined }} />
      </section>
    </div>
  );
}
