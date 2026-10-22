import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { conversationMembers, conversations, jobs, messages, proposals, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { type Actor, requireCapability } from "@/domain/permissions";
import { messageSchema, parseOrThrow } from "@/domain/validation";
import { listAttachments } from "./files";
import { notify } from "./notifications";
import { assertNotBlocked } from "./safety";

export const EDIT_WINDOW_MS = 15 * 60_000;

const MAX_MESSAGES_PER_MINUTE = 20;

/** Clients start the conversation from a proposal (freelancers reply). Idempotent per proposal. */
export async function openProposalConversation(db: DB, actor: Actor, proposalId: string) {
  requireCapability(actor, "client");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ p: proposals, job: jobs })
      .from(proposals)
      .innerJoin(jobs, eq(jobs.id, proposals.jobId))
      .where(eq(proposals.id, proposalId));
    if (!row || row.job.clientId !== actor.userId) throw new AppError("NOT_FOUND", "Proposal not found");
    if (row.p.status === "withdrawn") throw new AppError("CONFLICT", "This proposal was withdrawn");
    await assertNotBlocked(tx, actor.userId, row.p.freelancerId);
    const [created] = await tx
      .insert(conversations)
      .values({ jobId: row.job.id, proposalId, subject: row.job.title, createdBy: actor.userId })
      .onConflictDoNothing({ target: conversations.proposalId })
      .returning();
    const conv = created ?? (await tx.select().from(conversations).where(eq(conversations.proposalId, proposalId)))[0];
    await tx
      .insert(conversationMembers)
      .values([
        { conversationId: conv.id, userId: actor.userId, role: "owner" },
        { conversationId: conv.id, userId: row.p.freelancerId, role: "member" },
      ])
      .onConflictDoNothing();
    return conv;
  });
}

async function assertMember(db: Executor, actor: Actor, conversationId: string) {
  const [m] = await db
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actor.userId)));
  // Guessing another conversation's id yields the same answer as a non-existent id.
  if (!m) throw new AppError("NOT_FOUND", "Conversation not found");
  return m;
}

export async function listMyConversations(db: Executor, actor: Actor) {
  return db.execute<{ id: string; subject: string; last_message_at: Date | null; other_name: string; unread: number; last_body: string | null }>(sql`
    select c.id, c.subject, c.last_message_at,
      (select u.display_name from conversation_members m2 join users u on u.id = m2.user_id
        where m2.conversation_id = c.id and m2.user_id <> ${actor.userId} limit 1) as other_name,
      (select count(*)::int from messages mm where mm.conversation_id = c.id and mm.sender_id <> ${actor.userId}
        and (cm.last_read_at is null or mm.created_at > cm.last_read_at)) as unread,
      (select left(body, 120) from messages mm where mm.conversation_id = c.id order by created_at desc limit 1) as last_body
    from conversation_members cm join conversations c on c.id = cm.conversation_id
    where cm.user_id = ${actor.userId}
    order by coalesce(c.last_message_at, c.created_at) desc`);
}

export async function getConversation(db: Executor, actor: Actor, conversationId: string, opts: { markRead?: boolean } = {}) {
  await assertMember(db, actor, conversationId);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  const members = await db
    .select({ userId: conversationMembers.userId, role: conversationMembers.role, displayName: users.displayName })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversationId));
  const msgs = await db
    .select({ id: messages.id, body: messages.body, createdAt: messages.createdAt, editedAt: messages.editedAt, deletedAt: messages.deletedAt, senderId: messages.senderId, senderName: users.displayName })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(500);
  const files = await listAttachments(db, actor, "message", msgs.filter((m) => !m.deletedAt).map((m) => m.id));
  const other = members.find((m) => m.userId !== actor.userId);
  const blocked = other ? await isBlocked(db, actor.userId, other.userId) : false;
  const proposal = conv.proposalId
    ? (await db.select({ id: proposals.id, status: proposals.status }).from(proposals).where(eq(proposals.id, conv.proposalId)))[0]
    : null;
  if (opts.markRead) {
    await db
      .update(conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actor.userId)));
  }
  return {
    conversation: conv,
    members,
    blocked,
    messages: msgs.map((m) => ({ ...m, body: m.deletedAt ? "" : m.body, files: m.deletedAt ? [] : files.filter((f) => f.entityId === m.id), canEdit: m.senderId === actor.userId && !m.deletedAt && Date.now() - m.createdAt.getTime() < EDIT_WINDOW_MS })),
    proposal,
  };
}

export async function postMessage(db: DB, actor: Actor, conversationId: string, raw: unknown) {
  const input = parseOrThrow(messageSchema, raw);
  return db.transaction(async (tx) => {
    await assertMember(tx, actor, conversationId);
    const others = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
    for (const o of others) if (o.userId !== actor.userId) await assertNotBlocked(tx, actor.userId, o.userId);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.senderId, actor.userId), gt(messages.createdAt, new Date(Date.now() - 60_000))));
    if (Number(n) >= MAX_MESSAGES_PER_MINUTE) throw new AppError("RATE_LIMITED", "You're sending messages too quickly. Wait a minute.");
    const [m] = await tx.insert(messages).values({ conversationId, senderId: actor.userId, body: input.body }).returning();
    await tx.update(conversations).set({ lastMessageAt: m.createdAt }).where(eq(conversations.id, conversationId));
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: m.createdAt })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actor.userId)));
    const [conv] = await tx.select({ subject: conversations.subject }).from(conversations).where(eq(conversations.id, conversationId));
    for (const o of others) {
      if (o.userId === actor.userId) continue;
      // Notification text never includes the private message body.
      await notify(tx, { userId: o.userId, category: "messages", kind: "message.received", title: `New message from ${actor.displayName}`, body: `In "${conv.subject}"`, link: `/app/messages/${conversationId}`, dedupeKey: `message:${m.id}` });
    }
    return m;
  });
}

/** Sender may edit or delete their own message within the edit window; edits are marked, deletions leave a tombstone. */
export async function editMessage(db: DB, actor: Actor, messageId: string, op: "edit" | "delete", raw?: unknown) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(messages).where(eq(messages.id, messageId)).for("update");
    if (!m) throw new AppError("NOT_FOUND", "Message not found");
    await assertMember(tx, actor, m.conversationId);
    if (m.senderId !== actor.userId) throw new AppError("FORBIDDEN", "You can only change your own messages");
    if (m.deletedAt) throw new AppError("CONFLICT", "Message was deleted");
    if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS) throw new AppError("CONFLICT", "Messages can only be changed within 15 minutes");
    if (op === "delete") {
      await tx.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, messageId));
    } else {
      const input = parseOrThrow(messageSchema, raw);
      await tx.update(messages).set({ body: input.body, editedAt: new Date() }).where(eq(messages.id, messageId));
    }
    return m.conversationId;
  });
}

async function isBlocked(db: Executor, a: string, b: string) {
  try {
    await assertNotBlocked(db, a, b);
    return false;
  } catch {
    return true;
  }
}

export async function listMessages(db: Executor, actor: Actor, conversationId: string) {
  await assertMember(db, actor, conversationId);
  return db
    .select({ id: messages.id, body: messages.body, createdAt: messages.createdAt, senderId: messages.senderId })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(100);
}
