import { AppError } from "./errors";

export type AdminRole = "superadmin" | "support" | "moderator" | "finance";
export type AdminPermission =
  | "users.read"
  | "users.suspend"
  | "roles.grant"
  | "moderation.services"
  | "moderation.reviews"
  | "reports.handle"
  | "support.handle"
  | "payments.read"
  | "disputes.resolve"
  | "audit.read";

/** Admin permission matrix (documented in SECURITY_PRIVACY.md). Staff get only what their role needs. */
export const ADMIN_MATRIX: Record<AdminRole, readonly AdminPermission[]> = {
  superadmin: ["users.read", "users.suspend", "roles.grant", "moderation.services", "moderation.reviews", "reports.handle", "support.handle", "payments.read", "disputes.resolve", "audit.read"],
  support: ["users.read", "support.handle"],
  moderator: ["users.read", "users.suspend", "moderation.services", "moderation.reviews", "reports.handle"],
  finance: ["payments.read", "disputes.resolve", "audit.read"],
};

export function adminCan(roles: readonly AdminRole[], perm: AdminPermission): boolean {
  return roles.some((r) => ADMIN_MATRIX[r].includes(perm));
}

export function requireAdmin(roles: readonly AdminRole[], perm: AdminPermission) {
  // Non-staff get NOT_FOUND so the admin surface is not discoverable; staff without the permission get FORBIDDEN.
  if (roles.length === 0) throw new AppError("NOT_FOUND", "Not found");
  if (!adminCan(roles, perm)) throw new AppError("FORBIDDEN", `Your staff role doesn't include ${perm}`);
}
