import Link from "next/link";
import { notFound } from "next/navigation";
import { postMessageAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { Card, Notice, PageHeader, StatusBadge, Textarea, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { requireActor } from "@/lib/session";
import { getConversation } from "@/server/services/messaging";

export const metadata = { title: "Conversation" };

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data;
  try {
    data = await getConversation(getDb(), actor, id, { markRead: true });
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const other = data.members.find((m) => m.userId !== actor.userId);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={other?.displayName ?? "Conversation"}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{data.conversation.subject}{data.proposal ? <><span>· proposal</span><StatusBadge status={data.proposal.status} /><Link className="text-brand hover:underline" href={`/app/proposals/${data.proposal.id}`}>open</Link></> : null}</span>}
      />
      <Notice>Keep contact and payment details off WorkSpring until a contract starts. Messages are private to the members of this conversation.</Notice>
      <Card>
        <ol className="space-y-3" aria-label="Messages">
          {data.messages.length === 0 ? <li className="text-sm text-muted">No messages yet. Say hello.</li> : null}
          {data.messages.map((m) => {
            const mine = m.senderId === actor.userId;
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${mine ? "bg-brand text-white" : "bg-canvas text-ink"}`}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={`mt-1 text-[11px] ${mine ? "text-white/80" : "text-muted"}`}>{mine ? "You" : m.senderName} · {formatDate(m.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
      <ActionForm action={postMessageAction} submitLabel="Send message" pendingLabel="Sending…">
        <input type="hidden" name="conversationId" value={id} />
        <label htmlFor="body" className="sr-only">Message</label>
        <Textarea id="body" name="body" rows={3} required maxLength={5000} placeholder="Write a message…" />
      </ActionForm>
    </div>
  );
}
