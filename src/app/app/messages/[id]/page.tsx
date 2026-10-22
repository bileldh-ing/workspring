import Link from "next/link";
import { notFound } from "next/navigation";
import { editMessageAction, postMessageWithFilesAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { BlockForm, FileInput, FileList, ReportForm } from "@/components/r2";
import { Card, Notice, PageHeader, StatusBadge, Textarea, formatDate } from "@/components/ui";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { userBlocks } from "@/db/schema";
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
  const iBlocked = other ? (await getDb().select().from(userBlocks).where(and(eq(userBlocks.blockerId, actor.userId), eq(userBlocks.blockedId, other.userId)))).length > 0 : false;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={other?.displayName ?? "Conversation"}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{data.conversation.subject}{data.proposal ? <><span>· proposal</span><StatusBadge status={data.proposal.status} /><Link className="text-brand hover:underline" href={`/app/proposals/${data.proposal.id}`}>open</Link></> : null}</span>}
      />
      <Notice>Keep contact and payment details off WorkSpring until a contract starts. Messages are private to the members of this conversation. Links from other members are not verified: be careful before opening them.</Notice>
      {data.blocked ? <Notice tone="warn" title="Messaging is blocked">One of you has blocked the other, so new messages can&apos;t be sent.</Notice> : null}
      <Card>
        <ol className="space-y-3" aria-label="Messages">
          {data.messages.length === 0 ? <li className="text-sm text-muted">No messages yet. Say hello.</li> : null}
          {data.messages.map((m) => {
            const mine = m.senderId === actor.userId;
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${mine ? "bg-brand text-white" : "bg-canvas text-ink"}`}>
                  {m.deletedAt ? <p className="italic opacity-80">Message deleted</p> : <p className="whitespace-pre-wrap">{m.body}</p>}
                  {m.files.length ? <div className={mine ? "[&_a]:text-white [&_span]:text-white/80" : ""}><FileList files={m.files} /></div> : null}
                  <p className={`mt-1 text-[11px] ${mine ? "text-white/80" : "text-muted"}`}>
                    {mine ? "You" : m.senderName} · {formatDate(m.createdAt)}{m.editedAt ? " · edited" : ""}
                  </p>
                  {m.canEdit ? (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-white/90">Edit or delete (15 min window)</summary>
                      <div className="mt-2 space-y-2 rounded-md bg-surface p-2 text-ink">
                        <ActionForm action={editMessageAction} submitLabel="Save edit" variant="secondary">
                          <input type="hidden" name="messageId" value={m.id} />
                          <input type="hidden" name="op" value="edit" />
                          <label htmlFor={`edit-${m.id}`} className="sr-only">Edit message</label>
                          <Textarea id={`edit-${m.id}`} name="body" rows={2} defaultValue={m.body} maxLength={5000} />
                        </ActionForm>
                        <ActionForm action={editMessageAction} submitLabel="Delete message" variant="danger" confirm="Delete this message for everyone?">
                          <input type="hidden" name="messageId" value={m.id} />
                          <input type="hidden" name="op" value="delete" />
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
      {!data.blocked ? (
        <ActionForm action={postMessageWithFilesAction} submitLabel="Send message" pendingLabel="Sending…">
          <input type="hidden" name="conversationId" value={id} />
          <label htmlFor="body" className="sr-only">Message</label>
          <Textarea id="body" name="body" rows={3} maxLength={5000} placeholder="Write a message…" />
          <FileInput label="Attach files (optional)" />
        </ActionForm>
      ) : null}
      {other ? (
        <div className="flex flex-wrap items-start gap-4 border-t border-line pt-4">
          <BlockForm userId={other.userId} blocked={iBlocked} back={`/app/messages/${id}`} />
          <ReportForm targetType="user" targetId={other.userId} label={`Report ${other.displayName}`} />
        </div>
      ) : null}
    </div>
  );
}
