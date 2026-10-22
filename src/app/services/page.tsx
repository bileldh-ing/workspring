import Link from "next/link";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { Pagination } from "@/components/pagination";
import { buttonClass, Card, DemoBadge, EmptyState, Input, PageHeader, Select, TestModeBadge } from "@/components/ui";
import { searchServices } from "@/server/services/catalog";
import { listCategories } from "@/server/services/taxonomy";

export const metadata = { title: "Services catalog" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

export default async function Services({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const db = getDb();
  const maxPrice = sp.maxPrice && /^\d{1,7}$/.test(sp.maxPrice) ? Number(sp.maxPrice) : undefined;
  const page = sp.page && /^\d{1,3}$/.test(sp.page) ? Number(sp.page) : 1;
  const sort = sp.sort === "price_asc" ? "price_asc" : "relevance";
  const [result, cats] = await Promise.all([searchServices(db, { q: sp.q, category: sp.category || undefined, maxPrice, sort, page }), listCategories(db)]);
  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <aside>
        <form method="get" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4" role="search" aria-label="Filter services">
          <label className="block text-sm font-medium" htmlFor="q">Keywords</label>
          <Input id="q" name="q" defaultValue={sp.q} placeholder="e.g. landing page" />
          <label className="block text-sm font-medium" htmlFor="category">Category</label>
          <Select id="category" name="category" defaultValue={sp.category}>
            <option value="">Any category</option>
            {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </Select>
          <label className="block text-sm font-medium" htmlFor="maxPrice">Starting price up to (major units)</label>
          <Input id="maxPrice" name="maxPrice" type="number" min={0} defaultValue={sp.maxPrice ?? ""} />
          <label className="block text-sm font-medium" htmlFor="sort">Sort by</label>
          <Select id="sort" name="sort" defaultValue={sort}>
            <option value="relevance">Relevance / newest</option>
            <option value="price_asc">Lowest starting price</option>
          </Select>
          <div className="flex gap-2 pt-1">
            <button className={buttonClass("primary")}>Apply filters</button>
            <Link href="/services" className={buttonClass("ghost")}>Reset</Link>
          </div>
        </form>
      </aside>
      <section aria-labelledby="results-heading">
        <PageHeader
          title="Services catalog"
          subtitle={<span id="results-heading">{result.total} published service{result.total === 1 ? "" : "s"}. Every listing is reviewed by a moderator before it goes live.</span>}
          actions={<TestModeBadge />}
        />
        {result.results.length === 0 ? (
          <EmptyState title="No services match these filters">Try fewer filters, or <Link href="/jobs" className="text-brand underline">post a job</Link> instead.</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="service-results">
            {result.results.map((s) => (
              <li key={s.id}>
                <Card className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold"><Link href={`/services/${s.slug}`} className="text-ink hover:text-brand">{s.title}</Link></h2>
                    {s.is_demo ? <DemoBadge /> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">by {s.seller_name} · {s.category_name ?? "Uncategorised"}</p>
                  <p className="mt-2 line-clamp-3 flex-1 text-sm text-ink-soft">{s.summary}</p>
                  <p className="mt-3 text-sm"><span className="text-muted">From</span> <span className="font-semibold">{formatMoney(s.starting_minor, s.currency)}</span> <span className="text-muted">· {s.delivery_days}-day delivery</span></p>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} base="/services" params={{ ...sp, page: undefined }} />
      </section>
    </div>
  );
}
