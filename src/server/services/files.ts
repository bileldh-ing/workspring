import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db/client";
import {
  adminRoles,
  attachments,
  contracts,
  conversationMembers,
  disputes,
  jobs,
  messages,
  milestoneSubmissions,
  milestones,
  orderDeliveries,
  proposals,
  serviceOrders,
  supportTickets,
} from "@/db/schema";
import { AppError } from "@/domain/errors";
import { checkUpload, MAX_FILES_PER_UPLOAD } from "@/domain/files";
import type { Actor } from "@/domain/permissions";
import { getStorage, signDownload } from "../storage";

export type EntityType = (typeof attachments.$inferSelect)["entityType"];

/** Who may read files attached to an entity. Mirrors the read rules of the entity itself. */
export async function canAccessEntity(db: Executor, userId: string, type: EntityType, id: string): Promise<boolean> {
  switch (type) {
    case "proposal": {
      const [r] = await db.select({ f: proposals.freelancerId, c: jobs.clientId }).from(proposals).innerJoin(jobs, eq(jobs.id, proposals.jobId)).where(eq(proposals.id, id));
      return !!r && (r.f === userId || r.c === userId);
    }
    case "message": {
      const [r] = await db
        .select({ u: conversationMembers.userId })
        .from(messages)
        .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, userId)))
        .where(eq(messages.id, id));
      return !!r;
    }
    case "milestone_submission": {
      const [r] = await db
        .select({ c: contracts.clientId, f: contracts.freelancerId })
        .from(milestoneSubmissions)
        .innerJoin(milestones, eq(milestones.id, milestoneSubmissions.milestoneId))
        .innerJoin(contracts, eq(contracts.id, milestones.contractId))
        .where(eq(milestoneSubmissions.id, id));
      return !!r && (r.c === userId || r.f === userId) ? true : isStaff(db, userId, ["superadmin", "finance"]);
    }
    case "order_delivery": {
      const [r] = await db.select({ b: serviceOrders.buyerId, s: serviceOrders.sellerId }).from(orderDeliveries).innerJoin(serviceOrders, eq(serviceOrders.id, orderDeliveries.orderId)).where(eq(orderDeliveries.id, id));
      return !!r && (r.b === userId || r.s === userId);
    }
    case "support_ticket": {
      const [r] = await db.select({ u: supportTickets.userId }).from(supportTickets).where(eq(supportTickets.id, id));
      return !!r && (r.u === userId || (await isStaff(db, userId, ["superadmin", "support"])));
    }
    case "dispute": {
      const [r] = await db.select({ c: contracts.clientId, f: contracts.freelancerId }).from(disputes).innerJoin(contracts, eq(contracts.id, disputes.contractId)).where(eq(disputes.id, id));
      return !!r && (r.c === userId || r.f === userId || (await isStaff(db, userId, ["superadmin", "finance"])));
    }
  }
}

async function isStaff(db: Executor, userId: string, roles: (typeof adminRoles.$inferSelect)["role"][]) {
  const r = await db.select().from(adminRoles).where(and(eq(adminRoles.userId, userId), inArray(adminRoles.role, roles)));
  return r.length > 0;
}

/** Validates and stores uploaded files for an entity the caller just created or can write to. */
export async function storeAttachments(db: Executor, actor: Actor, type: EntityType, entityId: string, files: File[]) {
  const real = files.filter((f) => f && typeof f === "object" && f.size > 0);
  if (real.length === 0) return [];
  if (real.length > MAX_FILES_PER_UPLOAD) throw new AppError("VALIDATION", `Attach at most ${MAX_FILES_PER_UPLOAD} files`);
  if (!(await canAccessEntity(db, actor.userId, type, entityId))) throw new AppError("NOT_FOUND", "Not found");
  const prepared = [];
  for (const f of real) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const check = checkUpload(f.name, bytes.byteLength, bytes.slice(0, 16));
    if (!check.ok) throw new AppError("VALIDATION", `${f.name}: ${check.reason}`, { files: check.reason });
    prepared.push({ bytes, check });
  }
  const storage = getStorage();
  const out = [];
  for (const { bytes, check } of prepared) {
    const id = crypto.randomUUID();
    const storageKey = `${type}/${entityId}/${id}`;
    await storage.put(storageKey, bytes, check.mime);
    const [row] = await db
      .insert(attachments)
      .values({ id, uploaderId: actor.userId, entityType: type, entityId, storageKey, fileName: check.name, mimeType: check.mime, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") })
      .returning();
    out.push(row);
  }
  return out;
}

/** Attachments for entities the caller may read, each with a fresh signed short-lived URL. */
export async function listAttachments(db: Executor, actor: Actor, type: EntityType, entityIds: string[]) {
  if (entityIds.length === 0) return [];
  const rows = await db.select().from(attachments).where(and(eq(attachments.entityType, type), inArray(attachments.entityId, entityIds)));
  const allowed = new Map<string, boolean>();
  const out = [];
  for (const r of rows) {
    if (!allowed.has(r.entityId)) allowed.set(r.entityId, await canAccessEntity(db, actor.userId, type, r.entityId));
    if (allowed.get(r.entityId)) out.push({ id: r.id, entityId: r.entityId, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, url: signDownload(r.id, actor.userId) });
  }
  return out;
}

/** Loads bytes for a download after re-checking entity access (the signed URL alone is not sufficient). */
export async function readAttachment(db: Executor, userId: string, fileId: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, fileId));
  if (!row || !(await canAccessEntity(db, userId, row.entityType, row.entityId))) throw new AppError("NOT_FOUND", "File not found");
  const bytes = await getStorage().get(row.storageKey);
  if (!bytes) throw new AppError("NOT_FOUND", "File not found");
  return { row, bytes };
}

export const filesFrom = (fd: FormData, key = "files") => fd.getAll(key).filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v && (v as File).size > 0);
