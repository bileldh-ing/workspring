import Link from "next/link";
import { agencyAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Field, Input, Notice, PageHeader, Select, StatusBadge, Textarea, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { agencyCan, canRemove } from "@/domain/agency";
import { requireActor } from "@/lib/session";
import { getAgencyForMember, myAgencies, myAgencyInvitations } from "@/server/services/agencies";

export const metadata = { title: "Agency" };

export default async function AgencyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requireActor("/app/agency");
  if (!actor.capabilities.includes("freelancer")) {
    return <><PageHeader title="Agency" /><Notice tone="warn">Agencies are for freelancers. Add freelancer capability from <Link className="underline" href="/app/settings">Settings</Link>.</Notice></>;
  }
  const db = getDb();
  const [mine, invites] = await Promise.all([myAgencies(db, actor), myAgencyInvitations(db, actor)]);
  const selected = mine.find((m) => m.a.id === sp.id) ?? mine[0];
  const view = selected ? await getAgencyForMember(db, actor, selected.a.id) : null;
  const owns = mine.some((m) => m.role === "owner");
  const aid = view ? <input type="hidden" name="agencyId" value={view.agency.id} /> : null;
  return (
    <>
      <PageHeader title="Agency" subtitle="Agencies group freelancers under one public profile. Every member keeps their own account, contracts and earnings; nobody shares credentials." />
      {invites.length ? (
        <Card className="space-y-2">
          <h2 className="font-semibold">Invitations for you</h2>
          {invites.map(({ inv, agencyName }) => (
            <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-canvas px-3 py-2 text-sm">
              <span><span className="font-semibold">{agencyName}</span> invited you as <span className="capitalize">{inv.role}</span> · expires {formatDate(inv.expiresAt)}</span>
              <span className="flex gap-2">
                <ActionForm action={agencyAction} submitLabel="Accept" inline><input type="hidden" name="op" value="accept" /><input type="hidden" name="invitationId" value={inv.id} /></ActionForm>
                <ActionForm action={agencyAction} submitLabel="Decline" variant="secondary" inline><input type="hidden" name="op" value="decline" /><input type="hidden" name="invitationId" value={inv.id} /></ActionForm>
              </span>
            </div>
          ))}
        </Card>
      ) : null}

      {mine.length > 1 ? (
        <nav aria-label="Your agencies" className="flex flex-wrap gap-2 text-sm">
          {mine.map((m) => <Link key={m.a.id} href={`/app/agency?id=${m.a.id}`} className={`rounded-full border px-3 py-1 ${m.a.id === selected?.a.id ? "border-brand bg-brand-soft" : "border-line"}`}>{m.a.name} ({m.role})</Link>)}
        </nav>
      ) : null}

      {view ? (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{view.agency.name}</h2>
              <span className="text-sm text-muted">Your role: <span className="font-semibold capitalize">{view.myRole}</span> · {view.agency.isPublished ? <Link className="text-brand underline" href={`/agencies/${view.agency.slug}`}>public page</Link> : "not published"}</span>
            </div>
            {agencyCan(view.myRole, "edit_profile") ? (
              <ActionForm action={agencyAction} submitLabel="Save agency profile">
                <input type="hidden" name="op" value="update" />{aid}
                <Field label="Agency name" name="name"><Input name="name" defaultValue={view.agency.name} /></Field>
                <Field label="Description" name="description" hint="30–3000 characters"><Textarea name="description" rows={4} defaultValue={view.agency.description} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="publish" defaultChecked={view.agency.isPublished} /> Show a public agency page</label>
              </ActionForm>
            ) : <p className="whitespace-pre-line text-sm text-ink-soft">{view.agency.description}</p>}
          </Card>

          <Card className="space-y-2">
            <h2 className="font-semibold">Members ({view.members.length})</h2>
            <ul className="divide-y divide-line text-sm">
              {view.members.map((m) => {
                const self = m.userId === actor.userId;
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="agency-member">
                    <span>
                      {m.profileSlug ? <Link className="font-semibold text-brand hover:underline" href={`/freelancers/${m.profileSlug}`}>{m.displayName}</Link> : <span className="font-semibold">{m.displayName}</span>}
                      {self ? " (you)" : ""} · <span className="capitalize">{m.role}</span>{m.title ? <span className="text-muted"> · {m.title}</span> : null}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {agencyCan(view.myRole, "change_role") && m.role !== "owner" ? (
                        <ActionForm action={agencyAction} submitLabel={m.role === "admin" ? "Make member" : "Make admin"} variant="secondary" inline>
                          <input type="hidden" name="op" value="role" />{aid}<input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="role" value={m.role === "admin" ? "member" : "admin"} />
                        </ActionForm>
                      ) : null}
                      {canRemove(view.myRole, m.role, self) ? (
                        <ActionForm action={agencyAction} submitLabel={self ? "Leave agency" : "Remove"} variant="danger" inline confirm={self ? "Leave this agency?" : `Remove ${m.displayName} from the agency? Their own account and contracts are unaffected.`}>
                          <input type="hidden" name="op" value="remove" />{aid}<input type="hidden" name="userId" value={m.userId} />
                        </ActionForm>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          {agencyCan(view.myRole, "invite") ? (
            <Card className="space-y-3">
              <h2 className="font-semibold">Invite a freelancer</h2>
              <ActionForm action={agencyAction} submitLabel="Send invitation">
                <input type="hidden" name="op" value="invite" />{aid}
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                  <Field label="Freelancer's WorkSpring email" name="email"><Input name="email" type="email" required /></Field>
                  <Field label="Role" name="role"><Select name="role" defaultValue="member"><option value="member">Member</option><option value="admin">Admin</option></Select></Field>
                </div>
                <p className="text-xs text-muted">We don't reveal whether an email has an account. Invitations expire after 14 days.</p>
              </ActionForm>
              {view.invites.length ? (
                <ul className="space-y-1 text-sm">
                  {view.invites.map(({ inv, name }) => (
                    <li key={inv.id} className="flex flex-wrap items-center gap-2">{name} · <span className="capitalize">{inv.role}</span> · <StatusBadge status={inv.status} />
                      {inv.status === "sent" ? <ActionForm action={agencyAction} submitLabel="Revoke" variant="ghost" inline><input type="hidden" name="op" value="revoke" /><input type="hidden" name="invitationId" value={inv.id} /></ActionForm> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : (
        <EmptyState title="You're not in an agency">Create one below, or accept an invitation from an agency owner.</EmptyState>
      )}

      {!owns ? (
        <Card>
          <h2 className="mb-2 font-semibold">Create an agency</h2>
          <ActionForm action={agencyAction} submitLabel="Create agency">
            <input type="hidden" name="op" value="create" />
            <Field label="Agency name" name="name"><Input name="name" required /></Field>
            <Field label="Description" name="description" hint="30–3000 characters. Describe what your team does."><Textarea name="description" rows={3} required /></Field>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
