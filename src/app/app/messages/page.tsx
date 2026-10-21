import Link from "next/link";
import { getDb } from "@/db/client";
import { EmptyState, PageHeader, timeAgo } from "@/components/ui";
import { requireActor } from "@/lib/session";
import { listMyConversations } from "@/server/services/messaging";

export const metadata = { title: "Messages" };

export default async function Messages() {
  const actor = await requireActor();
  const rows = await listMyConversations(getDb(), actor);
  return (
    <div>
      <PageHeader title="Messages" subtitle="Private conversations you are a member of." />
      {rows.length === 0 ? <EmptyState title="No conversations yet">Clients start a conversation from a proposal.</EmptyState> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/app/messages/${c.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-canvas">
                <div className="min-w-0">
                  <p className="font-medium">{c.other_name} <span className="text-muted">· {c.subject}</span></p>
                  <p className="truncate text-sm text-muted">{c.last_body ?? "No messages yet"}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-muted">
                  {timeAgo(c.last_message_at)}
                  {c.unread > 0 ? <span className="ml-2 rounded-full bg-brand px-2 py-0.5 font-semibold text-white">{c.unread} new</span> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
