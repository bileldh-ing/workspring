import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketThread } from "@/components/ticket-thread";
import { Notice, PageHeader } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { requireActor } from "@/lib/session";
import { listAttachments } from "@/server/services/files";
import { getTicket } from "@/server/services/support";

export const metadata = { title: "Support ticket" };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const actor = await requireActor(`/app/support/${id}`);
  const db = getDb();
  let data;
  try {
    data = await getTicket(db, actor, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const files = await listAttachments(db, actor, "support_ticket", [id]).catch(() => []);
  return (
    <>
      <PageHeader title={data.ticket.subject} subtitle={<Link href={data.asStaff ? "/admin/support" : "/app/support"} className="text-brand underline">← All tickets</Link>} />
      {sp.created ? <Notice tone="success">Ticket sent. Support replies here and you’ll get a notification.</Notice> : null}
      <TicketThread data={data} files={files} />
    </>
  );
}
