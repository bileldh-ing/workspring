import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { Card, LinkButton } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Real counts from the database (including synthetic demo rows, which are labelled as such).
  const [counts] = await getDb().execute<{ jobs: number; talent: number }>(sql`
    select (select count(*)::int from jobs where status = 'open') as jobs,
           (select count(*)::int from freelancer_profiles where status = 'published') as talent`);
  return (
    <div className="space-y-12">
      <section className="grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">Freelance work, clearly agreed</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-ink md:text-5xl">Scope it, agree it, ship it, milestone by milestone.</h1>
          <p className="mt-4 max-w-xl text-lg text-ink-soft">
            Post a job, compare proposals, agree fixed-price milestones and track every delivery, revision and payment event in one workroom.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href="/join?intent=hire">I want to hire</LinkButton>
            <LinkButton href="/join?intent=work" variant="secondary">I want to offer services</LinkButton>
          </div>
          <p className="mt-3 text-sm text-muted">
            {counts.jobs} open jobs · {counts.talent} public profiles right now
          </p>
        </div>
        <Card className="space-y-3">
          <p className="text-sm font-semibold text-ink">How a WorkSpring contract moves</p>
          <ol className="space-y-2 text-sm text-ink-soft">
            {["Client posts a job", "Freelancers send proposals with their terms", "Client messages, then sends a milestone offer", "Freelancer accepts: the contract starts", "Each milestone: fund → deliver → revise → approve → release"].map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">Payments currently run against a clearly labelled test provider; WorkSpring does not hold or protect funds.</p>
        </Card>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          { t: "Find work", d: "Full-text job search with skill, budget and level filters.", href: "/jobs" },
          { t: "Browse talent", d: "Public profiles with skills, rates and real on-platform history only.", href: "/talent" },
          { t: "Transparent fees", d: "A versioned fee rule is snapshotted onto every contract.", href: "/fees" },
        ].map((c) => (
          <Card key={c.t}>
            <h2 className="font-semibold text-ink">{c.t}</h2>
            <p className="mt-1 text-sm text-muted">{c.d}</p>
            <Link href={c.href} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
              Open {c.t.toLowerCase()} →
            </Link>
          </Card>
        ))}
      </section>
    </div>
  );
}
