import { addCapabilityAction, logoutAction, switchModeAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { buttonClass, Card, Notice, PageHeader } from "@/components/ui";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireActor();
  const { error } = await searchParams;
  const missing = (["client", "freelancer"] as const).filter((c) => !actor.capabilities.includes(c));
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Settings" />
      {error ? <Notice tone="danger">You need that capability before switching to it.</Notice> : null}
      <Card className="space-y-1 text-sm">
        <p><span className="text-muted">Name:</span> {actor.displayName}</p>
        <p><span className="text-muted">Email:</span> {actor.email} · {actor.emailVerified ? "verified" : "not verified"}</p>
        <p><span className="text-muted">Capabilities:</span> {actor.capabilities.join(", ")}</p>
        <p><span className="text-muted">Current workspace:</span> {actor.activeMode}</p>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Workspaces</h2>
        <p className="text-sm text-muted">One login can hire and work. Adding a capability never creates a second account.</p>
        {actor.capabilities.filter((c) => c !== "admin").map((c) =>
          c === actor.activeMode ? null : (
            <form key={c} action={switchModeAction}>
              <input type="hidden" name="mode" value={c} />
              <button className={buttonClass("secondary")}>Switch to {c} workspace</button>
            </form>
          ),
        )}
        {missing.map((c) => (
          <ActionForm key={c} action={addCapabilityAction} submitLabel={c === "client" ? "Add hiring (client) capability" : "Add freelancer capability"} variant="secondary">
            <input type="hidden" name="capability" value={c} />
          </ActionForm>
        ))}
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Session</h2>
        <form action={logoutAction}>
          <button className={buttonClass("danger")}>Sign out</button>
        </form>
        <p className="mt-2 text-xs text-muted">Planned: account deletion and data export requests, notification preferences, phone verification.</p>
      </Card>
    </div>
  );
}
