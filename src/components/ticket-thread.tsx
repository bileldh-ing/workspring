import { ticketAction } from "@/app/actions/r2";
import { ActionForm } from "./action-form";
import { FileList } from "./r2";
import { Card, Field, StatusBadge, Textarea, formatDate } from "./ui";

type Data = {
  ticket: { id: string; subject: string; category: string; status: string; createdAt: Date };
  messages: { m: { id: string; body: string; isStaff: boolean; createdAt: Date }; authorName: string }[];
  asStaff: boolean; ownerName: string; ownerEmail?: string;
};

/** Shared ticket view for the ticket owner and support staff (server-side authorization already applied). */
export function TicketThread({ data, files }: { data: Data; files: { id: string; fileName: string; sizeBytes: number; url: string }[] }) {
  const t = data.ticket;
  const tid = <input type="hidden" name="ticketId" value={t.id} />;
  const statusOps: { op: string; label: string }[] = data.asStaff
    ? [{ op: "resolved", label: "Mark resolved" }, { op: "closed", label: "Close" }, ...(t.status !== "open" ? [{ op: "open", label: "Reopen" }] : [])]
    : t.status === "closed" ? [] : t.status === "resolved" ? [{ op: "open", label: "Reopen" }, { op: "closed", label: "Close ticket" }] : [{ op: "closed", label: "Close ticket" }];
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>Category: <span className="capitalize">{t.category}</span> · opened {formatDate(t.createdAt)}{data.asStaff ? ` · by ${data.ownerName}${data.ownerEmail ? ` <${data.ownerEmail}>` : ""}` : ""}</span>
        <StatusBadge status={t.status} />
      </Card>
      <ol className="space-y-2">
        {data.messages.map(({ m, authorName }, i) => (
          <li key={m.id} className={`rounded-md border px-3 py-2 text-sm ${m.isStaff ? "border-brand/30 bg-brand-soft" : "border-line bg-surface"}`}>
            <p className="text-xs text-muted">{m.isStaff ? `WorkSpring support (${authorName})` : authorName} · {formatDate(m.createdAt)}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
            {i === 0 ? <FileList files={files} /> : null}
          </li>
        ))}
      </ol>
      {t.status !== "closed" ? (
        <Card>
          <ActionForm action={ticketAction} submitLabel={data.asStaff ? "Reply as support" : "Send reply"}>
            {tid}<input type="hidden" name="op" value="reply" />
            <Field label="Reply" name="body"><Textarea name="body" rows={3} required /></Field>
          </ActionForm>
        </Card>
      ) : <p className="text-sm text-muted">This ticket is closed. Open a new ticket if you need more help.</p>}
      {statusOps.length ? (
        <div className="flex flex-wrap gap-2">
          {statusOps.filter((s) => s.op !== t.status).map((s) => (
            <ActionForm key={s.op} action={ticketAction} submitLabel={s.label} variant="secondary" inline>{tid}<input type="hidden" name="op" value={s.op} /></ActionForm>
          ))}
        </div>
      ) : null}
    </div>
  );
}
