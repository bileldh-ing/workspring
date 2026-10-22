export type AgencyRole = "owner" | "admin" | "member";
export type AgencyAction = "view_members" | "invite" | "remove_member" | "change_role" | "edit_profile" | "delete_agency";

/** Agency permission matrix (AGENCY_GUIDE.md). Agency membership never grants access to a member's personal account data or contracts. */
export const AGENCY_MATRIX: Record<AgencyRole, readonly AgencyAction[]> = {
  owner: ["view_members", "invite", "remove_member", "change_role", "edit_profile", "delete_agency"],
  admin: ["view_members", "invite", "remove_member", "edit_profile"],
  member: ["view_members"],
};

export const agencyCan = (role: AgencyRole | null, action: AgencyAction) => !!role && AGENCY_MATRIX[role].includes(action);

/** Admins may remove members only; the owner may remove anyone but themselves. Nobody can remove the owner. */
export function canRemove(actorRole: AgencyRole | null, targetRole: AgencyRole, isSelf: boolean): boolean {
  if (targetRole === "owner") return false;
  if (isSelf) return true; // anyone except the owner may leave
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole === "member";
  return false;
}
