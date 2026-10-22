import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { agencies, agencyInvitations, agencyMembers, freelancerProfiles, users } from "@/db/schema";
import { type AgencyRole, agencyCan, canRemove } from "@/domain/agency";
import { AppError } from "@/domain/errors";
import { type Actor, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import { assertTransition, invitationMachine } from "@/domain/state-machines";
import { agencySchema, parseOrThrow } from "@/domain/validation";
import { audit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import { notify } from "./notifications";
import { slugify } from "./taxonomy";

export async function createAgency(db: DB, actor: Actor, raw: unknown) {
  requireCapability(actor, "freelancer");
  requireVerifiedEmail(actor);
  const input = parseOrThrow(agencySchema, raw);
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: agencies.id }).from(agencies).where(eq(agencies.ownerId, actor.userId));
    if (owned) throw new AppError("CONFLICT", "You already own an agency");
    const [a] = await tx.insert(agencies).values({ slug: `${slugify(input.name) || "agency"}-${crypto.randomUUID().slice(0, 6)}`, name: input.name, description: input.description, ownerId: actor.userId }).returning();
    await tx.insert(agencyMembers).values({ agencyId: a.id, userId: actor.userId, role: "owner" });
    await audit(tx, { actorId: actor.userId, action: "agency.created", entityType: "agency", entityId: a.id });
    return a;
  });
}

async function membership(db: Executor, agencyId: string, userId: string) {
  const [m] = await db.select().from(agencyMembers).where(and(eq(agencyMembers.agencyId, agencyId), eq(agencyMembers.userId, userId), isNull(agencyMembers.removedAt)));
  return m ?? null;
}

/** Member-only agency view. Shows members' public profile info only; never personal account data or contracts. */
export async function getAgencyForMember(db: Executor, actor: Actor, agencyId: string) {
  const me = await membership(db, agencyId, actor.userId);
  if (!me) throw new AppError("NOT_FOUND", "Agency not found");
  const [a] = await db.select().from(agencies).where(eq(agencies.id, agencyId));
  const members = await db
    .select({ id: agencyMembers.id, userId: agencyMembers.userId, role: agencyMembers.role, joinedAt: agencyMembers.joinedAt, displayName: users.displayName, profileSlug: freelancerProfiles.slug, title: freelancerProfiles.title })
    .from(agencyMembers)
    .innerJoin(users, eq(users.id, agencyMembers.userId))
    .leftJoin(freelancerProfiles, eq(freelancerProfiles.userId, agencyMembers.userId))
    .where(and(eq(agencyMembers.agencyId, agencyId), isNull(agencyMembers.removedAt)));
  const invites = agencyCan(me.role, "invite")
    ? await db.select({ inv: agencyInvitations, name: users.displayName }).from(agencyInvitations).innerJoin(users, eq(users.id, agencyInvitations.inviteeId)).where(eq(agencyInvitations.agencyId, agencyId)).orderBy(desc(agencyInvitations.createdAt)).limit(50)
    : [];
  return { agency: a, myRole: me.role, members, invites };
}

export async function myAgencies(db: Executor, actor: Actor) {
  return db
    .select({ a: agencies, role: agencyMembers.role })
    .from(agencyMembers)
    .innerJoin(agencies, eq(agencies.id, agencyMembers.agencyId))
    .where(and(eq(agencyMembers.userId, actor.userId), isNull(agencyMembers.removedAt)));
}

export async function updateAgency(db: DB, actor: Actor, agencyId: string, raw: unknown, publish?: boolean) {
  const input = parseOrThrow(agencySchema, raw);
  return db.transaction(async (tx) => {
    const me = await membership(tx, agencyId, actor.userId);
    if (!me) throw new AppError("NOT_FOUND", "Agency not found");
    if (!agencyCan(me.role, "edit_profile")) throw new AppError("FORBIDDEN", "Your agency role can't edit the profile");
    await tx.update(agencies).set({ name: input.name, description: input.description, ...(publish === undefined ? {} : { isPublished: publish }), updatedAt: new Date() }).where(eq(agencies.id, agencyId));
    await audit(tx, { actorId: actor.userId, action: "agency.updated", entityType: "agency", entityId: agencyId, data: { publish: publish ?? null } });
  });
}

/** Invite an existing WorkSpring freelancer by email. Members accept with their own account; no shared credentials. */
export async function inviteMember(db: DB, actor: Actor, agencyId: string, email: string, role: AgencyRole) {
  if (role === "owner") throw new AppError("VALIDATION", "There is exactly one owner");
  return db.transaction(async (tx) => {
    const me = await membership(tx, agencyId, actor.userId);
    if (!me) throw new AppError("NOT_FOUND", "Agency not found");
    if (!agencyCan(me.role, "invite")) throw new AppError("FORBIDDEN", "Your agency role can't invite members");
    if (role === "admin" && me.role !== "owner") throw new AppError("FORBIDDEN", "Only the owner can invite admins");
    const [u] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
    // Same answer whether or not the email exists or has a freelancer profile (no account enumeration).
    const neutral = { ok: true as const };
    if (!u) return neutral;
    const [p] = await tx.select({ s: freelancerProfiles.status }).from(freelancerProfiles).where(eq(freelancerProfiles.userId, u.id));
    if (!p) return neutral;
    if (await membership(tx, agencyId, u.id)) throw new AppError("CONFLICT", "Already a member");
    try {
      const [inv] = await tx.insert(agencyInvitations).values({ agencyId, inviteeId: u.id, role, invitedBy: actor.userId, expiresAt: new Date(Date.now() + 14 * 86400_000) }).returning();
      const [a] = await tx.select({ name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId));
      await notify(tx, { userId: u.id, category: "proposals", kind: "agency.invited", title: `Invitation to join ${a.name}`, body: `Role: ${role}`, link: `/app/agency`, dedupeKey: `agency.invite:${inv.id}` });
      await audit(tx, { actorId: actor.userId, action: "agency.member_invited", entityType: "agency", entityId: agencyId, data: { inviteeId: u.id, role } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("CONFLICT", "An invitation is already pending");
      throw e;
    }
    return neutral;
  });
}

export async function myAgencyInvitations(db: Executor, actor: Actor) {
  return db
    .select({ inv: agencyInvitations, agencyName: agencies.name })
    .from(agencyInvitations)
    .innerJoin(agencies, eq(agencies.id, agencyInvitations.agencyId))
    .where(and(eq(agencyInvitations.inviteeId, actor.userId), eq(agencyInvitations.status, "sent")));
}

export async function respondAgencyInvitation(db: DB, actor: Actor, invitationId: string, accept: boolean) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(agencyInvitations).where(eq(agencyInvitations.id, invitationId)).for("update");
    if (!inv || inv.inviteeId !== actor.userId) throw new AppError("NOT_FOUND", "Invitation not found");
    if (inv.status === "sent" && inv.expiresAt < new Date()) {
      await tx.update(agencyInvitations).set({ status: "expired" }).where(eq(agencyInvitations.id, inv.id));
      throw new AppError("INVALID_TRANSITION", "This invitation has expired");
    }
    const to = accept ? "accepted" : "declined";
    assertTransition(invitationMachine, inv.status, to, "invitation");
    await tx.update(agencyInvitations).set({ status: to, respondedAt: new Date() }).where(eq(agencyInvitations.id, inv.id));
    if (accept) {
      try {
        await tx.insert(agencyMembers).values({ agencyId: inv.agencyId, userId: actor.userId, role: inv.role });
      } catch (e) {
        if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Already a member");
        throw e;
      }
    }
    await audit(tx, { actorId: actor.userId, action: `agency.invitation_${to}`, entityType: "agency", entityId: inv.agencyId });
  });
}

export async function revokeAgencyInvitation(db: DB, actor: Actor, invitationId: string) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(agencyInvitations).where(eq(agencyInvitations.id, invitationId)).for("update");
    if (!inv) throw new AppError("NOT_FOUND", "Invitation not found");
    const me = await membership(tx, inv.agencyId, actor.userId);
    if (!me || !agencyCan(me.role, "invite")) throw new AppError("NOT_FOUND", "Invitation not found");
    assertTransition(invitationMachine, inv.status, "revoked", "invitation");
    await tx.update(agencyInvitations).set({ status: "revoked", respondedAt: new Date() }).where(eq(agencyInvitations.id, inv.id));
    await audit(tx, { actorId: actor.userId, action: "agency.invitation_revoked", entityType: "agency", entityId: inv.agencyId });
  });
}

/**
 * Removes (or lets a member leave). Soft removal keeps history: the membership row is stamped removed_at/removed_by,
 * nothing about the member's own contracts, earnings or account is touched, and access ends immediately.
 */
export async function removeMember(db: DB, actor: Actor, agencyId: string, memberUserId: string) {
  return db.transaction(async (tx) => {
    const me = await membership(tx, agencyId, actor.userId);
    if (!me) throw new AppError("NOT_FOUND", "Agency not found");
    const target = await membership(tx, agencyId, memberUserId);
    if (!target) throw new AppError("NOT_FOUND", "Member not found");
    if (!canRemove(me.role, target.role, memberUserId === actor.userId)) throw new AppError("FORBIDDEN", target.role === "owner" ? "The owner can't be removed" : "Your agency role can't remove this member");
    await tx.update(agencyMembers).set({ removedAt: new Date(), removedBy: actor.userId }).where(eq(agencyMembers.id, target.id));
    await audit(tx, { actorId: actor.userId, action: memberUserId === actor.userId ? "agency.member_left" : "agency.member_removed", entityType: "agency", entityId: agencyId, data: { memberUserId } });
  });
}

export async function changeMemberRole(db: DB, actor: Actor, agencyId: string, memberUserId: string, role: AgencyRole) {
  if (role === "owner") throw new AppError("VALIDATION", "Ownership transfer is not supported in this build");
  return db.transaction(async (tx) => {
    const me = await membership(tx, agencyId, actor.userId);
    if (!me) throw new AppError("NOT_FOUND", "Agency not found");
    if (!agencyCan(me.role, "change_role")) throw new AppError("FORBIDDEN", "Only the owner changes roles");
    const target = await membership(tx, agencyId, memberUserId);
    if (!target || target.role === "owner") throw new AppError("NOT_FOUND", "Member not found");
    await tx.update(agencyMembers).set({ role }).where(eq(agencyMembers.id, target.id));
    await audit(tx, { actorId: actor.userId, action: "agency.role_changed", entityType: "agency", entityId: agencyId, data: { memberUserId, role } });
  });
}

/** Public agency page: published agencies only, with members' public profile info. */
export async function getPublicAgency(db: Executor, slug: string) {
  const [a] = await db.select().from(agencies).where(and(eq(agencies.slug, slug), eq(agencies.isPublished, true)));
  if (!a) return null;
  const members = await db
    .select({ role: agencyMembers.role, displayName: users.displayName, profileSlug: freelancerProfiles.slug, title: freelancerProfiles.title, status: freelancerProfiles.status })
    .from(agencyMembers)
    .innerJoin(users, eq(users.id, agencyMembers.userId))
    .leftJoin(freelancerProfiles, eq(freelancerProfiles.userId, agencyMembers.userId))
    .where(and(eq(agencyMembers.agencyId, a.id), isNull(agencyMembers.removedAt)));
  return { ...a, members: members.map((m) => ({ ...m, profileSlug: m.status === "published" ? m.profileSlug : null })) };
}
