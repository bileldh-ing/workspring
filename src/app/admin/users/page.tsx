import { adminAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { NoPermission } from "@/components/admin-bits";
import { buttonClass, DemoBadge, EmptyState, Input, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import type { AdminRole } from "@/domain/admin";
import { staffContext } from "@/lib/staff";
import { rolesForUsers, searchUsers } from "@/server/services/admin";

export const metadata = { title: "Users" };
const ROLES: AdminRole[] = ["superadmin", "support", "moderator", "finance"];

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, can } = await staffContext("/admin/users");
  if (!can("users.read")) return <NoPermission perm="users.read" />;
  const q = (await searchParams).q ?? "";
  const db = getDb();
  const rows = await searchUsers(db, actor, q);
  const roles = await rolesForUsers(db, actor, rows.map((r) => r.id));
  return (
    <>
      <PageHeader title="Users" subtitle="Search by email or name. Suspending signs the user out everywhere and is audited with your reason." />
      <form method="get" role="search" className="flex gap-2"><Input name="q" aria-label="Search users" defaultValue={q} placeholder="email or name" /><button className={buttonClass("primary")}>Search</button></form>
      {rows.length === 0 ? <EmptyState title="No users match" /> : (
        <ul className="space-y-2">
          {rows.map((u) => {
            const ur = roles.filter((r) => r.userId === u.id).map((r) => r.role);
            return (
              <li key={u.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-3 text-sm" data-testid="admin-user">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.displayName}</span><span className="text-muted">{u.email}</span><StatusBadge status={u.status} />{u.isDemo ? <DemoBadge /> : null}
                  {ur.length ? <span className="text-xs text-brand">staff: {ur.join(", ")}</span> : null}
                  <span className="ml-auto text-xs text-muted">joined {formatDate(u.createdAt)}{u.emailVerifiedAt ? " · verified email" : " · email unverified"}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {can("users.suspend") && u.id !== actor.userId ? (
                    <ActionForm action={adminAction} submitLabel={u.status === "suspended" ? "Reinstate" : "Suspend"} variant={u.status === "suspended" ? "secondary" : "danger"} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="op" value={u.status === "suspended" ? "reinstate" : "suspend"} /><input type="hidden" name="userId" value={u.id} />
                      <Input name="reason" aria-label={`Reason for ${u.displayName}`} placeholder="Reason (audited)" className="w-56" />
                    </ActionForm>
                  ) : null}
                  {can("roles.grant") ? (
                    <details className="text-xs"><summary className="cursor-pointer font-semibold text-muted">Staff roles</summary>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {ROLES.map((r) => (
                          <ActionForm key={r} action={adminAction} submitLabel={`${ur.includes(r) ? "Revoke" : "Grant"} ${r}`} variant="ghost" inline>
                            <input type="hidden" name="op" value={ur.includes(r) ? "revoke_role" : "grant"} /><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="role" value={r} />
                          </ActionForm>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
