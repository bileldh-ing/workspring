import Link from "next/link";
import { resendVerificationAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

const NAV = {
  freelancer: [
    { href: "/app", label: "Overview" },
    { href: "/jobs", label: "Find work" },
    { href: "/app/proposals", label: "Proposals" },
    { href: "/app/offers", label: "Offers" },
    { href: "/app/contracts", label: "Contracts" },
    { href: "/app/messages", label: "Messages" },
    { href: "/app/profile", label: "Profile" },
    { href: "/app/settings", label: "Settings" },
  ],
  client: [
    { href: "/app", label: "Overview" },
    { href: "/app/jobs/new", label: "Post a job" },
    { href: "/app/jobs", label: "Manage jobs" },
    { href: "/talent", label: "Talent search" },
    { href: "/app/offers", label: "Offers" },
    { href: "/app/contracts", label: "Contracts" },
    { href: "/app/messages", label: "Messages" },
    { href: "/app/settings", label: "Settings" },
  ],
};

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("/app");
  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      <nav aria-label="Workspace" className="md:sticky md:top-4 md:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{actor.activeMode === "client" ? "Client workspace" : "Freelancer workspace"}</p>
        <ul className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV[actor.activeMode].map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="block whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-brand-soft hover:text-brand">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-4">
        {!actor.emailVerified ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
            <span>Verify your email ({actor.email}) to publish jobs, send proposals and make offers. In development, open the <Link href="/dev/outbox" className="underline">dev outbox</Link>.</span>
            <ActionForm action={resendVerificationAction} submitLabel="Resend email" variant="secondary" inline>
              {null}
            </ActionForm>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
