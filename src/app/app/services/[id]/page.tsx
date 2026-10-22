import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceTransitionAction, updateServiceAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { ServiceFields } from "@/components/service-form";
import { Card, Notice, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { requireActor } from "@/lib/session";
import { getOwnedService } from "@/server/services/catalog";
import { listCategories } from "@/server/services/taxonomy";

export const metadata = { title: "Edit service" };

const NEXT: Record<string, { to: string; label: string; variant: "primary" | "secondary" | "danger" }[]> = {
  draft: [{ to: "pending_review", label: "Submit for review", variant: "primary" }, { to: "archived", label: "Archive", variant: "danger" }],
  changes_requested: [{ to: "pending_review", label: "Resubmit for review", variant: "primary" }, { to: "archived", label: "Archive", variant: "danger" }],
  pending_review: [],
  published: [{ to: "paused", label: "Pause", variant: "secondary" }, { to: "archived", label: "Archive", variant: "danger" }],
  paused: [{ to: "published", label: "Resume", variant: "primary" }, { to: "archived", label: "Archive", variant: "danger" }],
  archived: [],
};

export default async function EditService({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const actor = await requireActor(`/app/services/${id}`);
  const db = getDb();
  let s;
  try {
    s = await getOwnedService(db, actor, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const cats = await listCategories(db);
  return (
    <>
      <PageHeader title={s.title} subtitle={<span className="inline-flex items-center gap-2">Status: <StatusBadge status={s.status} />{s.status === "published" ? <Link className="text-brand underline" href={`/services/${s.slug}`}>View public page</Link> : null}</span>} />
      {sp.created ? <Notice tone="success">Draft saved. Submit it for review when it's ready.</Notice> : null}
      {s.status === "pending_review" ? <Notice>Waiting for a moderator. You'll get a notification with the decision.</Notice> : null}
      {s.status === "changes_requested" && s.moderationNote ? <Notice tone="warn" title="Changes requested">{s.moderationNote}</Notice> : null}
      {s.status === "published" ? <Notice>Editing a published service sends it back to review before the changes go live.</Notice> : null}
      <div className="flex flex-wrap gap-2">
        {(NEXT[s.status] ?? []).map((n) => (
          <ActionForm key={n.to} action={serviceTransitionAction} submitLabel={n.label} variant={n.variant} inline confirm={n.to === "archived" ? "Archive this service? This can't be undone." : undefined}>
            <input type="hidden" name="serviceId" value={s.id} />
            <input type="hidden" name="to" value={n.to} />
          </ActionForm>
        ))}
      </div>
      {s.status !== "archived" ? (
        <Card>
          <ActionForm action={updateServiceAction} submitLabel="Save changes" pendingLabel="Saving…">
            <input type="hidden" name="serviceId" value={s.id} />
            <ServiceFields categories={cats} initial={s} />
          </ActionForm>
        </Card>
      ) : null}
      <Card>
        <h2 className="mb-2 font-semibold">History</h2>
        <ul className="space-y-1 text-sm">
          {s.events.map((e) => <li key={e.id}><span className="text-muted">{formatDate(e.createdAt)}:</span> {e.fromStatus ?? "created"} → {e.toStatus}{e.note ? ` (${e.note})` : ""}</li>)}
        </ul>
      </Card>
    </>
  );
}
