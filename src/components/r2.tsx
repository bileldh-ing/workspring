import { blockAction, reportAction, uploadAttachmentsAction } from "@/app/actions/r2";
import { ActionForm } from "./action-form";
import { Field, Select, Textarea } from "./ui";

export const ACCEPT_ATTR = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.zip,.docx,.xlsx,.pptx";

export function FileInput({ label = "Attachments (optional)", name = "files" }: { label?: string; name?: string }) {
  return (
    <Field label={label} name={name} hint="Up to 5 files, 10 MB each. PDF, images, text/CSV/Markdown, ZIP, Word, Excel, PowerPoint. Files are private to the participants.">
      <input id={name} name={name} type="file" multiple accept={ACCEPT_ATTR} className="mt-1 block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
    </Field>
  );
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Private files with short-lived signed links (generated per viewer at render time). */
export function FileList({ files }: { files: { id: string; fileName: string; sizeBytes: number; url: string }[] }) {
  if (!files.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2">
          <span aria-hidden="true">📎</span>
          <a href={f.url} className="font-medium text-brand hover:underline" rel="noopener">{f.fileName}</a>
          <span className="text-muted">({fmtSize(f.sizeBytes)})</span>
        </li>
      ))}
    </ul>
  );
}

export function AttachForm({ entityType, entityId, back }: { entityType: "proposal" | "milestone_submission" | "order_delivery" | "support_ticket" | "dispute"; entityId: string; back: string }) {
  return (
    <ActionForm action={uploadAttachmentsAction} submitLabel="Upload files" variant="secondary" pendingLabel="Uploading…">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="back" value={back} />
      <FileInput label="Add files" />
    </ActionForm>
  );
}

const REASONS: [string, string][] = [
  ["spam", "Spam"],
  ["scam_or_fraud", "Scam or fraud"],
  ["harassment", "Harassment"],
  ["fake_profile", "Fake profile or impersonation"],
  ["inappropriate", "Inappropriate content"],
  ["malicious_file", "Malicious file or link"],
  ["off_platform_payment", "Asked to pay outside WorkSpring"],
  ["other", "Other"],
];

/** Collapsible report form (native <details>, no JS needed). */
export function ReportForm({ targetType, targetId, label = "Report" }: { targetType: "user" | "job" | "message" | "service" | "review"; targetId: string; label?: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-muted hover:text-danger">{label}</summary>
      <div className="mt-2 max-w-md rounded-md border border-line bg-canvas p-3">
        <ActionForm action={reportAction} submitLabel="Send report" variant="danger">
          <input type="hidden" name="targetType" value={targetType} />
          <input type="hidden" name="targetId" value={targetId} />
          <Field label="Reason" name="reason">
            <Select id="reason" name="reason" defaultValue="spam">
              {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Details (optional, only staff can see this)" name="details">
            <Textarea id="details" name="details" rows={2} maxLength={2000} />
          </Field>
        </ActionForm>
      </div>
    </details>
  );
}

export function BlockForm({ userId, blocked, back }: { userId: string; blocked: boolean; back: string }) {
  return (
    <ActionForm action={blockAction} submitLabel={blocked ? "Unblock member" : "Block member"} variant={blocked ? "secondary" : "danger"} inline confirm={blocked ? undefined : "Block this member? They won't be able to message you, apply to your jobs or send you offers."}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="op" value={blocked ? "unblock" : "block"} />
      <input type="hidden" name="back" value={back} />
    </ActionForm>
  );
}

export function Stars({ rating, label }: { rating: number; label?: string }) {
  return (
    <span aria-label={label ?? `${rating} out of 5 stars`} className="font-semibold text-warn">
      {"★".repeat(Math.round(rating))}
      <span className="text-line-strong">{"★".repeat(5 - Math.round(rating))}</span>
    </span>
  );
}
