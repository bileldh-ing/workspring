import { adminAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { NoPermission } from "@/components/admin-bits";
import { Card, DemoBadge, EmptyState, Field, PageHeader, Textarea, timeAgo } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { staffContext } from "@/lib/staff";
import { getServiceForStaff, listPendingServices } from "@/server/services/catalog";

export const metadata = { title: "Service moderation" };

export default async function Moderation() {
  const { can } = await staffContext("/admin/moderation");
  if (!can("moderation.services")) return <NoPermission perm="moderation.services" />;
  const db = getDb();
  const pending = await listPendingServices(db);
  const full = await Promise.all(pending.map((p) => getServiceForStaff(db, p.l.id)));
  return (
    <>
      <PageHeader title="Service moderation" subtitle="Approve to publish, or request changes with a note the seller will see. Decisions are audited." />
      {full.length === 0 ? <EmptyState title="Queue is empty">No services are waiting for review.</EmptyState> : full.map((s, i) => (
        <Card key={s.id} className="space-y-2 text-sm" data-testid="moderation-item">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{s.title}</h2>{s.isDemo ? <DemoBadge /> : null}<span className="ml-auto text-xs text-muted">by {pending[i].sellerName} · submitted {timeAgo(s.updatedAt)}</span></div>
          <p className="text-ink-soft">{s.summary}</p>
          <details><summary className="cursor-pointer text-muted">Full description, packages, add-ons, requirements</summary>
            <p className="mt-2 whitespace-pre-line">{s.description}</p>
            <ul className="mt-2 list-disc pl-5">{s.tiers.map((t) => <li key={t.id}><span className="capitalize">{t.tier}</span>: {t.name}, {formatMoney(t.priceMinor, s.currency)}, {t.deliveryDays}d, {t.revisions} rev.</li>)}</ul>
            {s.addons.length ? <p className="mt-1">Add-ons: {s.addons.map((a) => `${a.name} (${formatMoney(a.priceMinor, s.currency)})`).join(", ")}</p> : null}
            {s.requirements.length ? <p className="mt-1">Requirements: {s.requirements.map((r) => r.prompt).join(" | ")}</p> : null}
          </details>
          <div className="grid gap-3 md:grid-cols-2">
            <ActionForm action={adminAction} submitLabel="Approve and publish" variant="accent">
              <input type="hidden" name="op" value="moderate" /><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="decision" value="approve" />
            </ActionForm>
            <ActionForm action={adminAction} submitLabel="Request changes" variant="secondary">
              <input type="hidden" name="op" value="moderate" /><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="decision" value="request_changes" />
              <Field label="What needs to change?" name="note"><Textarea name="note" id={`note-${s.id}`} rows={2} /></Field>
            </ActionForm>
          </div>
        </Card>
      ))}
    </>
  );
}
