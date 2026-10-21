import { desc } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { emailOutbox } from "@/db/schema";

/**
 * Queues an email. Idempotent on dedupeKey: retrying the same logical send never creates a duplicate.
 * R1 has no SMTP transport configured; queued mail is readable in the dev viewer (/dev/outbox).
 */
export async function enqueueEmail(
  db: Executor,
  m: { to: string; template: string; subject: string; body: string; dedupeKey: string },
) {
  const rows = await db
    .insert(emailOutbox)
    .values({ toEmail: m.to, template: m.template, subject: m.subject, bodyText: m.body, dedupeKey: m.dedupeKey })
    .onConflictDoNothing({ target: emailOutbox.dedupeKey })
    .returning({ id: emailOutbox.id });
  return { queued: rows.length === 1 };
}

export function listOutbox(db: Executor, limit = 50) {
  return db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(limit);
}

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
