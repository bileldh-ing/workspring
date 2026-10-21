import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Card, Notice, PageHeader, formatDate } from "@/components/ui";
import { listOutbox } from "@/server/services/outbox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev email outbox", robots: { index: false } };

const linkify = (text: string) =>
  text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part.replace(/^https?:\/\/[^/]+/, "")} className="break-all text-brand underline">
        {part}
      </a>
    ) : (
      part
    ),
  );

/** Development-only viewer for the email_outbox table (no SMTP transport is configured in R1). */
export default async function DevOutbox() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_OUTBOX !== "true") notFound();
  const mail = await listOutbox(getDb());
  return (
    <div className="space-y-4">
      <PageHeader title="Dev email outbox" subtitle="Emails queued in the email_outbox table. Disabled in production unless ENABLE_DEV_OUTBOX=true." />
      <Notice tone="warn">Development tool. Links below are rewritten to this host so you can click through verification and reset flows.</Notice>
      {mail.length === 0 ? <p className="text-sm text-muted">No emails yet.</p> : null}
      {mail.map((m) => (
        <Card key={m.id}>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="font-semibold">{m.subject}</span>
            <span className="text-muted">
              to {m.toEmail} · {m.template} · {m.status} · {formatDate(m.createdAt)}
            </span>
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-ink-soft">{linkify(m.bodyText)}</pre>
        </Card>
      ))}
    </div>
  );
}
