import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, DemoBadge } from "@/components/ui";
import { getDb } from "@/db/client";
import { getPublicAgency } from "@/server/services/agencies";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = await getPublicAgency(getDb(), (await params).slug);
  return { title: a ? `${a.name} (agency)` : "Agency not found" };
}

export default async function PublicAgency({ params }: { params: Promise<{ slug: string }> }) {
  const a = await getPublicAgency(getDb(), (await params).slug);
  if (!a) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-bold tracking-tight">{a.name}</h1><span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">Agency</span>{a.isDemo ? <DemoBadge /> : null}</div>
      <Card><p className="whitespace-pre-line text-sm text-ink-soft">{a.description}</p></Card>
      <Card>
        <h2 className="mb-2 font-semibold">Team</h2>
        <ul className="space-y-1 text-sm">
          {a.members.map((m, i) => <li key={i}>{m.profileSlug ? <Link className="font-semibold text-brand hover:underline" href={`/freelancers/${m.profileSlug}`}>{m.displayName}</Link> : <span className="font-semibold">{m.displayName}</span>} <span className="capitalize text-muted">· {m.role}</span>{m.title ? <span className="text-muted"> · {m.title}</span> : null}</li>)}
        </ul>
        <p className="mt-3 text-xs text-muted">Hire individual members through their profiles. Agency-level contracts are not offered in this build.</p>
      </Card>
    </div>
  );
}
