import { addCapabilityAction, logoutAction, switchModeAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { buttonClass, Card, Notice, PageHeader } from "@/components/ui";
import { requireActor } from "@/lib/session";
import { savePreferencesAction } from "@/app/actions/r2";
import { BlockForm } from "@/components/r2";
import { getDb } from "@/db/client";
import { getPreferences } from "@/server/services/notifications";
import { listBlocked } from "@/server/services/safety";

export const metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireActor();
  const { error } = await searchParams;
  const [prefs, blocked] = await Promise.all([getPreferences(getDb(), actor), listBlocked(getDb(), actor)]);
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
        <h2 className="mb-1 font-semibold">Notifications</h2>
        <p className="mb-3 text-sm text-muted">Choose where each kind of update reaches you. Payment and security/safety alerts always appear in-app because they can need action.</p>
        <ActionForm action={savePreferencesAction} submitLabel="Save preferences" variant="secondary">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Type</th><th className="font-medium">In-app</th><th className="font-medium">Email</th></tr></thead>
            <tbody>
              {prefs.map((p) => (
                <tr key={p.category} className="border-t border-line">
                  <td className="py-2">{p.label}</td>
                  <td><input type="checkbox" name={`inapp_${p.category}`} defaultChecked={p.inApp} disabled={p.mandatory} aria-label={`${p.label}: in-app`} />{p.mandatory ? <input type="hidden" name={`inapp_${p.category}`} value="on" /> : null}</td>
                  <td><input type="checkbox" name={`email_${p.category}`} defaultChecked={p.email} aria-label={`${p.label}: email`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ActionForm>
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Blocked members</h2>
        {blocked.length === 0 ? <p className="text-sm text-muted">You haven&apos;t blocked anyone.</p> : (
          <ul className="space-y-2">
            {blocked.map((b) => <li key={b.id} className="flex items-center justify-between gap-3 text-sm"><span>{b.displayName}</span><BlockForm userId={b.id} blocked back="/app/settings" /></li>)}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Session</h2>
        <form action={logoutAction}>
          <button className={buttonClass("danger")}>Sign out</button>
        </form>
        <p className="mt-2 text-xs text-muted">Planned: self-service account deletion and data export, phone verification. Until then, open a support ticket for deletion or export requests.</p>
      </Card>
    </div>
  );
}
