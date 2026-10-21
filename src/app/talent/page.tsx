import Link from "next/link";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { talentSearchSchema } from "@/domain/validation";
import { AVAILABILITY_LABELS, LEVEL_LABELS } from "@/components/labels";
import { Pagination } from "@/components/pagination";
import { buttonClass, Card, DemoBadge, EmptyState, Input, PageHeader, Select, Tag } from "@/components/ui";
import { searchTalent } from "@/server/services/profiles";
import { listSkills } from "@/server/services/taxonomy";

export const metadata = { title: "Browse talent" };
export const dynamic = "force-dynamic";

export default async function TalentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const parsed = talentSearchSchema.safeParse(sp);
  const params = parsed.success ? parsed.data : talentSearchSchema.parse({});
  const db = getDb();
  const [result, skills] = await Promise.all([searchTalent(db, params), listSkills(db)]);
  return (
    <div className="space-y-6">
      <PageHeader title="Browse talent" subtitle={`${result.total} public profile${result.total === 1 ? "" : "s"} match`} />
      <form method="get" role="search" aria-label="Filter talent" className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 md:grid-cols-5">
        <div className="md:col-span-2">
          <label htmlFor="q" className="text-sm font-medium">Keywords</label>
          <Input id="q" name="q" defaultValue={params.q} placeholder="e.g. postgres, branding" />
        </div>
        <div>
          <label htmlFor="skill" className="text-sm font-medium">Skill</label>
          <Select id="skill" name="skill" defaultValue={params.skill}>
            <option value="">Any skill</option>
            {skills.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="level" className="text-sm font-medium">Experience</label>
          <Select id="level" name="level" defaultValue={params.level}>
            <option value="">Any</option>
            {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="maxRate" className="text-sm font-medium">Max hourly rate (USD/EUR)</label>
          <Input id="maxRate" name="maxRate" type="number" min={0} defaultValue={params.maxRate ?? ""} />
        </div>
        <div className="flex gap-2 md:col-span-5">
          <button className={buttonClass("primary")}>Search</button>
          <Link href="/talent" className={buttonClass("ghost")}>Reset</Link>
        </div>
      </form>
      {result.results.length === 0 ? (
        <EmptyState title="No profiles match">Try a broader search.</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {result.results.map((r) => (
            <li key={r.user_id}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold"><Link href={`/freelancers/${r.slug}`} className="hover:text-brand">{r.display_name}</Link></h2>
                    <p className="text-sm text-ink-soft">{r.title}</p>
                  </div>
                  {r.is_demo ? <DemoBadge /> : null}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {r.hourly_rate_minor !== null ? `${formatMoney(r.hourly_rate_minor, r.currency)}/hr` : "Rate not set"} · {LEVEL_LABELS[r.experience_level]} · {AVAILABILITY_LABELS[r.availability]}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{r.overview}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{r.skills.map((s) => <Tag key={s.slug}>{s.name}</Tag>)}</div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} base="/talent" params={{ ...sp, page: undefined }} />
    </div>
  );
}
