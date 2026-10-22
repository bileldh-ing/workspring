import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { notificationPreferences, notifications, users } from "@/db/schema";
import type { Actor } from "@/domain/permissions";
import { appUrl, enqueueEmail } from "./outbox";

export const NOTIFICATION_CATEGORIES = {
  messages: "New messages",
  proposals: "Proposals, invitations and interviews",
  contracts: "Offers, contracts, milestones and timesheets",
  orders: "Service orders",
  payments: "Payments and payouts",
  reviews: "Reviews",
  safety: "Security, safety and support",
} as const;
export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

/** Security/payment categories cannot be switched off in-app (spec §10: critical alerts are not silently suppressed). */
export const MANDATORY_IN_APP: NotificationCategory[] = ["payments", "safety"];

/**
 * Creates an in-app notification (idempotent per user+dedupeKey, so retried transactions and replayed
 * webhooks never duplicate it) and queues an email when the user's preference allows.
 */
export async function notify(
  db: Executor,
  n: { userId: string; category: NotificationCategory; kind: string; title: string; body?: string; link?: string; dedupeKey: string },
) {
  const [pref] = await db
    .select()
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, n.userId), eq(notificationPreferences.category, n.category)));
  const inApp = MANDATORY_IN_APP.includes(n.category) || (pref?.inApp ?? true);
  const email = pref?.email ?? true;
  if (inApp) {
    await db
      .insert(notifications)
      .values({ userId: n.userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey })
      .onConflictDoNothing();
  }
  if (email) {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, n.userId));
    if (u) {
      await enqueueEmail(db, {
        to: u.email,
        template: `notify.${n.kind}`,
        subject: `WorkSpring: ${n.title}`,
        body: `${n.title}\n\n${n.body ?? ""}\n\n${n.link ? `${appUrl()}${n.link}` : appUrl()}\n\nManage notification settings: ${appUrl()}/app/settings`,
        dedupeKey: `notify:${n.userId}:${n.dedupeKey}`,
      });
    }
  }
}

export async function listNotifications(db: Executor, actor: Actor, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), opts.unreadOnly ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

export async function unreadCount(db: Executor, userId: string) {
  const [r] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(r?.n ?? 0);
}

export async function markRead(db: Executor, actor: Actor, id?: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
}

export async function getPreferences(db: Executor, actor: Actor) {
  const rows = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, actor.userId));
  return (Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]).map((c) => {
    const r = rows.find((x) => x.category === c);
    return { category: c, label: NOTIFICATION_CATEGORIES[c], email: r?.email ?? true, inApp: MANDATORY_IN_APP.includes(c) ? true : (r?.inApp ?? true), mandatory: MANDATORY_IN_APP.includes(c) };
  });
}

export async function setPreferences(db: Executor, actor: Actor, prefs: { category: string; email: boolean; inApp: boolean }[]) {
  for (const p of prefs) {
    if (!(p.category in NOTIFICATION_CATEGORIES)) continue;
    const inApp = MANDATORY_IN_APP.includes(p.category as NotificationCategory) ? true : p.inApp;
    await db
      .insert(notificationPreferences)
      .values({ userId: actor.userId, category: p.category, email: p.email, inApp })
      .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.category], set: { email: p.email, inApp } });
  }
}
