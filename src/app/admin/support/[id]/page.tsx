import Link from "next/link";
import { notFound } from "next/navigation";
import { NoPermission } from "@/components/admin-bits";
import { TicketThread } from "@/components/ticket-thread";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { staffContext } from "@/lib/staff";
import { listAttachments } from "@/server/services/files";
import { getTicket } from "@/server/services/support";

export const metadata = { title: "Ticket" };

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { actor, can } = await staffContext(`/admin/support/${id}`);
  if (!can("support.handle")) return <NoPermission perm="support.handle" />;
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
      <PageHeader title={data.ticket.subject} subtitle={<Link href="/admin/support" className="text-brand underline">← Support queue</Link>} />
      <TicketThread data={data} files={files} />
    </>
  );
}
