import Link from "next/link";
import { markNotificationsReadAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, PageHeader, timeAgo } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/session";
import { listNotifications } from "@/server/services/notifications";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const actor = await requireActor("/app/notifications");
  const items = await listNotifications(getDb(), actor, { limit: 100 });
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up"}
        actions={unread ? <ActionForm action={markNotificationsReadAction} submitLabel="Mark all as read" variant="secondary" inline>{null}</ActionForm> : null}
      />
      {items.length === 0 ? <EmptyState title="No notifications yet">Proposals, offers, messages, payments and reviews will show up here.</EmptyState> : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <Card className={`flex flex-wrap items-start justify-between gap-3 ${n.readAt ? "" : "border-brand/40 bg-brand-soft/40"}`}>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{!n.readAt ? <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand align-middle" aria-label="unread" /> : null}{n.title}</p>
                  {n.body ? <p className="text-sm text-ink-soft">{n.body}</p> : null}
                  <p className="text-xs text-muted">{timeAgo(n.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {n.link ? <Link href={n.link} className="text-sm font-semibold text-brand hover:underline">Open</Link> : null}
                  {!n.readAt ? (
                    <ActionForm action={markNotificationsReadAction} submitLabel="Mark read" variant="ghost" inline>
                      <input type="hidden" name="notificationId" value={n.id} />
                    </ActionForm>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
