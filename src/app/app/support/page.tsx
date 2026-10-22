import Link from "next/link";
import { openTicketAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { FileInput } from "@/components/r2";
import { Card, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Textarea, timeAgo } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/session";
import { listMyTickets } from "@/server/services/support";

export const metadata = { title: "Support" };

const CATS = [["account", "Account"], ["payments", "Payments"], ["contract", "Contract or order"], ["safety", "Trust & safety"], ["technical", "Technical problem"], ["other", "Other"]];

export default async function Support() {
  const actor = await requireActor("/app/support");
  const tickets = await listMyTickets(getDb(), actor);
  return (
    <>
      <PageHeader title="Support" subtitle="Ask WorkSpring support for help. Disputes about a milestone are opened from the contract workroom." />
      {tickets.length === 0 ? <EmptyState title="No tickets yet">Use the form below to contact support.</EmptyState> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {tickets.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div><Link href={`/app/support/${t.id}`} className="font-semibold text-ink hover:text-brand">{t.subject}</Link><p className="text-xs text-muted capitalize">{t.category} · updated {timeAgo(t.updatedAt)}</p></div>
              <StatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      )}
      <Card>
        <h2 className="mb-2 font-semibold">Open a ticket</h2>
        <ActionForm action={openTicketAction} submitLabel="Send to support" pendingLabel="Sending…">
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <Field label="Subject" name="subject"><Input name="subject" required minLength={5} maxLength={150} /></Field>
            <Field label="Category" name="category"><Select name="category" defaultValue="other">{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          </div>
          <Field label="How can we help?" name="body" hint="10–5000 characters. Never share passwords or full card numbers."><Textarea name="body" rows={4} required /></Field>
          <FileInput />
        </ActionForm>
      </Card>
    </>
  );
}
