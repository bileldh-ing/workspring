import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "accent" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-canvas",
  accent: "bg-accent text-white hover:brightness-95",
  danger: "bg-surface text-danger border border-danger/40 hover:bg-danger-soft",
  ghost: "text-brand hover:bg-brand-soft",
};
export const buttonClass = (v: Variant = "primary", extra = "") =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    variants[v],
    extra,
  );

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...p} />;
}

export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...p} />;
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cx("rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]", className)} {...p} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "danger" | "success"; title?: string; children: ReactNode }) {
  const tones = {
    info: "border-brand/30 bg-brand-soft text-ink",
    warn: "border-warn/30 bg-warn-soft text-warn",
    danger: "border-danger/30 bg-danger-soft text-danger",
    success: "border-accent/30 bg-accent-soft text-accent",
  };
  return (
    <div className={cx("rounded-[var(--radius-control)] border px-4 py-3 text-sm", tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  open: "bg-accent-soft text-accent",
  published: "bg-accent-soft text-accent",
  active: "bg-accent-soft text-accent",
  funded: "bg-accent-soft text-accent",
  released: "bg-accent-soft text-accent",
  approved: "bg-accent-soft text-accent",
  accepted: "bg-accent-soft text-accent",
  hired: "bg-accent-soft text-accent",
  succeeded: "bg-accent-soft text-accent",
  completed: "bg-accent-soft text-accent",
  shortlisted: "bg-brand-soft text-brand-strong",
  submitted: "bg-brand-soft text-brand-strong",
  sent: "bg-brand-soft text-brand-strong",
  offer_sent: "bg-brand-soft text-brand-strong",
  funding_pending: "bg-warn-soft text-warn",
  release_pending: "bg-warn-soft text-warn",
  requires_action: "bg-warn-soft text-warn",
  processing: "bg-warn-soft text-warn",
  revision_requested: "bg-warn-soft text-warn",
  paused: "bg-warn-soft text-warn",
  draft: "bg-canvas text-muted border border-line",
  unfunded: "bg-canvas text-muted border border-line",
  hidden: "bg-canvas text-muted border border-line",
  closed: "bg-canvas text-muted border border-line",
  declined: "bg-danger-soft text-danger",
  withdrawn: "bg-canvas text-muted border border-line",
  expired: "bg-canvas text-muted border border-line",
  failed: "bg-danger-soft text-danger",
  canceled: "bg-danger-soft text-danger",
};
export const statusLabel = (s: string) => s.replace(/_/g, " ");
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize", STATUS_TONE[status] ?? "bg-canvas text-muted")}>
      {statusLabel(status)}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-line bg-canvas px-2.5 py-0.5 text-xs text-ink-soft">{children}</span>;
}

/** Honest label for seeded records. */
export function DemoBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warn" title="Synthetic demo record created by the seed script. Not a real person or job.">
      Synthetic demo
    </span>
  );
}

export function TestModeBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-warn/50 bg-warn-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn" title="Payments use a simulated test provider. No real money moves.">
      Test mode
    </span>
  );
}

const fieldBase =
  "mt-1 block w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 aria-[invalid=true]:border-danger";

export function Field({ label, name, error, hint, children }: { label: string; name: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <label htmlFor={name} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${name}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type WithErr = { error?: string };
export function Input({ error, className, ...p }: ComponentProps<"input"> & WithErr) {
  return <input id={p.id ?? p.name} aria-invalid={error ? true : undefined} aria-describedby={error ? `${p.name}-error` : undefined} className={cx(fieldBase, className)} {...p} />;
}
export function Textarea({ error, className, ...p }: ComponentProps<"textarea"> & WithErr) {
  return <textarea id={p.id ?? p.name} aria-invalid={error ? true : undefined} aria-describedby={error ? `${p.name}-error` : undefined} className={cx(fieldBase, "min-h-28", className)} {...p} />;
}
export function Select({ error, className, ...p }: ComponentProps<"select"> & WithErr) {
  return <select id={p.id ?? p.name} aria-invalid={error ? true : undefined} aria-describedby={error ? `${p.name}-error` : undefined} className={cx(fieldBase, className)} {...p} />;
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(d)) + " UTC";
}

export function timeAgo(d: Date | string | null | undefined) {
  if (!d) return "";
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  const units: [number, string][] = [[86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [n, u] of units) if (s >= n) return `${Math.floor(s / n)} ${u}${Math.floor(s / n) > 1 ? "s" : ""} ago`;
  return "just now";
}
