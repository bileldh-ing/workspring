import { asc, desc, eq, inArray } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { supportMessages, supportTickets, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import type { Actor } from "@/domain/permissions";
import { assertTransition, ticketMachine } from "@/domain/state-machines";
import { parseOrThrow, ticketSchema } from "@/domain/validation";
import { requireStaff } from "./admin";
import { audit } from "./audit";
import { notify } from "./notifications";

type TicketStatus = (typeof supportTickets.$inferSelect)["status"];

const hidden = () => new AppError("NOT_FOUND", "Ticket not found");

export async function openTicket(db: DB, actor: Actor, raw: unknown) {
  const input = parseOrThrow(ticketSchema, raw);
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(supportTickets).values({ userId: actor.userId, subject: input.subject, category: input.category }).returning();
    await tx.insert(supportMessages).values({ ticketId: t.id, authorId: actor.userId, body: input.body });
    return t;
  });
}

export async function listMyTickets(db: Executor, actor: Actor) {
  return db.select().from(supportTickets).where(eq(supportTickets.userId, actor.userId)).orderBy(desc(supportTickets.updatedAt));
}

/** Ticket owner or support staff only. Staff access is audited. */
export async function getTicket(db: DB, actor: Actor, id: string) {
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));
  if (!t) throw hidden();
  let asStaff = false;
  if (t.userId !== actor.userId) {
    await requireStaff(db, actor, "support.handle").catch(() => {
      throw hidden();
    });
    asStaff = true;
    await audit(db, { actorId: actor.userId, action: "support.ticket_viewed", entityType: "support_ticket", entityId: id });
  }
  const msgs = await db
    .select({ m: supportMessages, authorName: users.displayName })
    .from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.authorId))
    .where(eq(supportMessages.ticketId, id))
    .orderBy(asc(supportMessages.createdAt));
  const [owner] = await db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, t.userId));
  return { ticket: t, messages: msgs, asStaff, ownerName: owner?.name ?? "", ownerEmail: asStaff ? owner?.email : undefined };
}

export async function replyTicket(db: DB, actor: Actor, id: string, body: string) {
  const text = body.trim();
  if (text.length < 2 || text.length > 5000) throw new AppError("VALIDATION", "Write a reply (2–5000 characters)", { body: "Required" });
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for("update");
    if (!t) throw hidden();
    const isOwner = t.userId === actor.userId;
    if (!isOwner) {
      await requireStaff(tx, actor, "support.handle").catch(() => {
        throw hidden();
      });
    }
    if (t.status === "closed") throw new AppError("INVALID_TRANSITION", "This ticket is closed. Open a new one.");
    await tx.insert(supportMessages).values({ ticketId: id, authorId: actor.userId, body: text, isStaff: !isOwner });
    const next: TicketStatus = isOwner ? "open" : "waiting_on_user";
    if (t.status !== next) assertTransition(ticketMachine, t.status, next, "ticket");
    await tx.update(supportTickets).set({ status: next, updatedAt: new Date(), ...(isOwner ? {} : { assignedTo: actor.userId }) }).where(eq(supportTickets.id, id));
    if (!isOwner) {
      await audit(tx, { actorId: actor.userId, action: "support.replied", entityType: "support_ticket", entityId: id });
      await notify(tx, { userId: t.userId, category: "safety", kind: "support.reply", title: `Support replied: ${t.subject}`, link: `/app/support/${id}`, dedupeKey: `support.reply:${id}:${Date.now()}` });
    }
  });
}

export async function setTicketStatus(db: DB, actor: Actor, id: string, to: TicketStatus) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for("update");
    if (!t) throw hidden();
    const isOwner = t.userId === actor.userId;
    if (!isOwner) {
      await requireStaff(tx, actor, "support.handle").catch(() => {
        throw hidden();
      });
    }
    if (isOwner && to !== "closed" && to !== "open") throw new AppError("FORBIDDEN", "You can close or reopen your ticket");
    assertTransition(ticketMachine, t.status, to, "ticket");
    await tx.update(supportTickets).set({ status: to, updatedAt: new Date() }).where(eq(supportTickets.id, id));
    if (!isOwner) await audit(tx, { actorId: actor.userId, action: `support.${to}`, entityType: "support_ticket", entityId: id });
  });
}

export async function supportQueue(db: Executor, actor: Actor) {
  await requireStaff(db, actor, "support.handle");
  return db
    .select({ t: supportTickets, userName: users.displayName })
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.userId))
    .where(inArray(supportTickets.status, ["open", "waiting_on_user", "resolved"]))
    .orderBy(asc(supportTickets.updatedAt))
    .limit(100);
}
