"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { type ActionState, initialActionState } from "@/lib/action-state";
import { buttonClass } from "./ui";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "accent" | "danger" | "ghost";
  className?: string;
  inline?: boolean;
  confirm?: string;
};

function Submit({ label, pendingLabel, variant }: { label: string; pendingLabel?: string; variant: Props["variant"] }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={buttonClass(variant)}>
      {pending ? (pendingLabel ?? "Working…") : label}
    </button>
  );
}

/** Progressive form bound to a server action; announces errors/success to screen readers. */
export function ActionForm({ action, children, submitLabel, pendingLabel, variant = "primary", className, inline, confirm }: Props) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form
      action={formAction}
      className={className ?? (inline ? "inline-flex flex-col gap-1" : "space-y-4")}
      noValidate
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div aria-live="polite" role="status" className="empty:hidden">
        {state.error ? (
          <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            <p className="font-semibold">{state.error}</p>
            {state.fieldErrors && Object.keys(state.fieldErrors).length > 1 ? (
              <ul className="mt-1 list-disc pl-5">
                {Object.entries(state.fieldErrors).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-medium">{k.replace(/\.\d+\./, " ").replace(/([A-Z])/g, " $1").toLowerCase()}</span>: {v}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {state.ok && state.message ? <p className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm font-medium text-accent">{state.message}</p> : null}
      </div>
      <div>
        <Submit label={submitLabel} pendingLabel={pendingLabel} variant={variant} />
      </div>
    </form>
  );
}
