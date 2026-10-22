import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { type AdminPermission, adminCan } from "@/domain/admin";
import { requireActor } from "@/lib/session";
import { staffRoles } from "@/server/services/admin";

/** Admin surface gate: non-staff get a 404 (the console isn't discoverable); staff get their roles for UI decisions. */
export async function staffContext(path = "/admin") {
  const actor = await requireActor(path);
  const roles = await staffRoles(getDb(), actor.userId);
  if (roles.length === 0) notFound();
  return { actor, roles, can: (p: AdminPermission) => adminCan(roles, p) };
}
