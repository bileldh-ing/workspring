import { adminAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { NoPermission } from "@/components/admin-bits";
import { Stars } from "@/components/r2";
import { Card, EmptyState, Input, PageHeader, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { staffContext } from "@/lib/staff";
import { reviewsForModeration } from "@/server/services/admin";

export const metadata = { title: "Reviews" };

export default async function AdminReviews() {
  const { actor, can } = await staffContext("/admin/reviews");
  if (!can("moderation.reviews")) return <NoPermission perm="moderation.reviews" />;
  const rows = await reviewsForModeration(getDb(), actor);
  return (
    <>
      <PageHeader title="Reviews" subtitle="Hide reviews that break the content policy (with a note). Ratings are never edited." />
      {rows.length === 0 ? <EmptyState title="No reviews yet" /> : rows.map(({ r, reviewerName }) => (
        <Card key={r.id} className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Stars rating={r.rating} /><span className="font-semibold">{reviewerName}</span><span className="text-muted">({r.reviewerRole}) · {formatDate(r.createdAt)} · {r.visibleAt ? "revealed" : "not yet revealed"}{r.hiddenByModeration ? " · HIDDEN" : ""}</span></div>
          <p className="whitespace-pre-wrap">{r.body}</p>
          <ActionForm action={adminAction} submitLabel={r.hiddenByModeration ? "Unhide" : "Hide review"} variant={r.hiddenByModeration ? "secondary" : "danger"} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="op" value="review_visibility" /><input type="hidden" name="reviewId" value={r.id} /><input type="hidden" name="hidden" value={r.hiddenByModeration ? "0" : "1"} />
            <Input name="note" aria-label="Moderation note" placeholder="Note (audited)" className="w-64" />
          </ActionForm>
        </Card>
      ))}
    </>
  );
}
