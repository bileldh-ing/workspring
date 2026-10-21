import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { AVAILABILITY_LABELS, LEVEL_LABELS } from "@/components/labels";
import { Card, DemoBadge, Tag, formatDate } from "@/components/ui";
import { getPublicProfile } from "@/server/services/profiles";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await getPublicProfile(getDb(), (await params).slug);
  return { title: p ? `${p.displayName}: ${p.title}` : "Profile not found", description: p?.overview.slice(0, 150) };
}

/** Server-rendered public profile. Only published profiles; never shows email or private data. */
export default async function FreelancerProfile({ params }: { params: Promise<{ slug: string }> }) {
  const p = await getPublicProfile(getDb(), (await params).slug);
  if (!p) notFound();
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <article className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{p.displayName}</h1>
          {p.isDemo ? <DemoBadge /> : null}
        </div>
        <p className="text-lg text-ink-soft">{p.title}</p>
        <Card>
          <h2 className="font-semibold">Overview</h2>
          <div className="prose-ws text-sm text-ink-soft"><p>{p.overview}</p></div>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Skills</h2>
          <div className="flex flex-wrap gap-1.5">{p.skills.map((s) => <Tag key={s.slug}>{s.name}</Tag>)}</div>
        </Card>
      </article>
      <aside>
        <Card className="space-y-2 text-sm">
          <p className="text-xl font-semibold">{p.hourlyRateMinor ? `${formatMoney(p.hourlyRateMinor, p.currency)}/hr` : "Rate on request"}</p>
          <p className="text-muted">{AVAILABILITY_LABELS[p.availability]}</p>
          <p className="text-muted">{LEVEL_LABELS[p.experienceLevel]}</p>
          <p className="text-muted">{p.categoryName}</p>
          <p className="text-muted">Time zone: {p.timezone}</p>
          <p className="text-muted">Contracts completed on WorkSpring: {p.completedContracts}</p>
          <p className="text-xs text-muted">Member profile since {formatDate(p.publishedAt)}. No ratings or badges are shown: reviews are not built yet.</p>
        </Card>
      </aside>
    </div>
  );
}
