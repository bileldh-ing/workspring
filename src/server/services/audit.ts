import type { Executor } from "@/db/client";
import { auditLog } from "@/db/schema";

export async function audit(
  db: Executor,
  e: { actorId: string | null; action: string; entityType: string; entityId?: string; data?: Record<string, unknown> },
) {
  await db.insert(auditLog).values({ ...e, entityId: e.entityId ?? null, data: e.data ?? null });
}
