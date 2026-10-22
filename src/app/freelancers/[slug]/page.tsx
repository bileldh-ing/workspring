import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { AVAILABILITY_LABELS, LEVEL_LABELS } from "@/components/labels";
import { Card, DemoBadge, Tag, formatDate } from "@/components/ui";
import Link from "next/link";
import { inviteAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { BlockForm, ReportForm, Stars } from "@/components/r2";
import { Field, Notice, Select, Textarea, timeAgo } from "@/components/ui";
import { getActor } from "@/lib/session";
import { publishedServicesBy } from "@/server/services/catalog";
import { listMyJobs } from "@/server/services/jobs";
import { getPublicProfile } from "@/server/services/profiles";
import { publicReviewsFor } from "@/server/services/reviews";
import { isBlockedEitherWay } from "@/server/services/safety";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await getPublicProfile(getDb(), (await params).slug);
  return { title: p ? `${p.displayName}: ${p.title}` : "Profile not found", description: p?.overview.slice(0, 150) };
}

/** Server-rendered public profile. Only published profiles; never shows email or private data. */
export default async function FreelancerProfile({ params }: { params: Promise<{ slug: string }> }) {
  const p = await getPublicProfile(getDb(), (await params).slug);
  if (!p) notFound();
  const db = getDb();
  const actor = await getActor();
  const self = actor?.userId === p.userId;
  const [rev, services] = await Promise.all([publicReviewsFor(db, p.userId), publishedServicesBy(db, p.userId)]);
  const isClient = !!actor && !self && actor.capabilities.includes("client");
  const openJobs = isClient ? (await listMyJobs(db, actor)).filter((j) => j.status === "open") : [];
  const blocked = actor && !self ? await isBlockedEitherWay(db, actor.userId, p.userId) : false;
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
        {services.length ? (
          <Card>
            <h2 className="mb-2 font-semibold">Services</h2>
            <ul className="space-y-1 text-sm">{services.map((s) => <li key={s.id}><Link className="font-semibold text-brand hover:underline" href={`/services/${s.slug}`}>{s.title}</Link>{s.starter ? <span className="text-muted"> · from {formatMoney(s.starter.priceMinor, s.currency)}</span> : null}</li>)}</ul>
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-1 font-semibold">Reviews</h2>
          {rev.reviews.length === 0 ? (
            <p className="text-sm text-muted">No reviews yet. Reviews come only from completed WorkSpring contracts and orders, and are revealed double-blind.</p>
          ) : (
            <>
              <p className="mb-2 text-sm"><Stars rating={rev.average ?? 0} /> <span className="font-semibold">{rev.average?.toFixed(1)}</span> <span className="text-muted">from {rev.count} review{rev.count === 1 ? "" : "s"}</span></p>
              <ul className="space-y-3 text-sm">
                {rev.reviews.map(({ r, reviewerName }) => (
                  <li key={r.id} className="border-t border-line pt-2" data-testid="public-review">
                    <p><Stars rating={r.rating} /> <span className="font-semibold">{reviewerName}</span> <span className="text-xs text-muted">· {timeAgo(r.visibleAt)}</span></p>
                    <p className="whitespace-pre-wrap text-ink-soft">{r.body}</p>
                    {actor && !self ? <ReportForm targetType="review" targetId={r.id} label="Report review" /> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
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
          <p className="text-xs text-muted">Member profile since {formatDate(p.publishedAt)}. No identity-verification badges are shown: verification is not offered in this build.</p>
        </Card>
        {isClient ? (
          <Card className="mt-3 space-y-2 text-sm" data-testid="invite-box">
            <h2 className="font-semibold">Invite to a job</h2>
            {blocked ? <Notice tone="warn">You can't invite this member.</Notice> : openJobs.length === 0 ? (
              <p className="text-muted">You have no open jobs. <Link className="text-brand underline" href="/app/jobs/new">Post a job</Link> first.</p>
            ) : (
              <ActionForm action={inviteAction} submitLabel="Send invitation">
                <input type="hidden" name="freelancerId" value={p.userId} />
                <Field label="Job" name="jobId"><Select name="jobId">{openJobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</Select></Field>
                <Field label="Message" name="message" hint="10–2000 characters"><Textarea name="message" rows={3} defaultValue={`Hi ${p.displayName.split(" ")[0]}, I'd like you to look at this job and send a proposal if it's a fit.`} /></Field>
              </ActionForm>
            )}
          </Card>
        ) : !actor ? (
          <p className="mt-3 text-xs text-muted"><Link className="text-brand underline" href={`/signin?next=/freelancers/${p.slug}`}>Sign in</Link> as a client to invite {p.displayName} to a job.</p>
        ) : null}
        {actor && !self ? (
          <div className="mt-3 space-y-2">
            <ReportForm targetType="user" targetId={p.userId} label="Report this profile" />
            <BlockForm userId={p.userId} blocked={blocked} back={`/freelancers/${p.slug}`} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
