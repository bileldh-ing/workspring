import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { clientProfiles, emailTokens, sessions, userCapabilities, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import type { Actor, Capability, Mode } from "@/domain/permissions";
import { loginSchema, parseOrThrow, passwordResetSchema, registerSchema } from "@/domain/validation";
import { hashPassword, randomToken, sha256, verifyPassword } from "../auth/crypto";
import { audit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import { appUrl, enqueueEmail } from "./outbox";

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const VERIFY_TTL_MS = 48 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;

async function issueEmailToken(db: Executor, userId: string, purpose: "verify_email" | "reset_password") {
  const token = randomToken();
  const ttl = purpose === "verify_email" ? VERIFY_TTL_MS : RESET_TTL_MS;
  const [row] = await db
    .insert(emailTokens)
    .values({ userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl) })
    .returning({ id: emailTokens.id });
  return { token, id: row.id };
}

async function sendVerification(db: Executor, user: { id: string; email: string; displayName: string }) {
  const { token, id } = await issueEmailToken(db, user.id, "verify_email");
  await enqueueEmail(db, {
    to: user.email,
    template: "verify_email",
    subject: "Confirm your WorkSpring email",
    body: `Hi ${user.displayName},\n\nConfirm your email address to start posting jobs, sending proposals and making offers:\n${appUrl()}/verify-email?token=${token}\n\nThis link expires in 48 hours. If you did not create a WorkSpring account, ignore this message.`,
    dedupeKey: `verify_email:${id}`,
  });
}

export async function register(db: DB, raw: unknown) {
  const input = parseOrThrow(registerSchema, raw);
  const passwordHash = await hashPassword(input.password);
  const cap: Capability = input.intent === "hire" ? "client" : "freelancer";
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash, displayName: input.displayName, activeMode: cap as Mode })
        .returning();
      await tx.insert(userCapabilities).values({ userId: user.id, capability: cap });
      if (cap === "client") await tx.insert(clientProfiles).values({ userId: user.id });
      await sendVerification(tx, user);
      await audit(tx, { actorId: user.id, action: "auth.register", entityType: "user", entityId: user.id, data: { cap } });
      return { userId: user.id };
    });
  } catch (e) {
    if (isUniqueViolation(e, "users_email_lower_uq")) {
      throw new AppError("CONFLICT", "An account with this email already exists. Sign in or reset your password.", {
        email: "Email already registered",
      });
    }
    throw e;
  }
}

async function createSession(db: Executor, userId: string, userAgent?: string | null) {
  const token = randomToken();
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

// A real hash so unknown-email logins cost the same time as wrong-password logins.
let dummyHash: Promise<string> | null = null;

export async function login(db: DB, raw: unknown, userAgent?: string | null) {
  const input = parseOrThrow(loginSchema, raw);
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password-padding");
    await verifyPassword(await dummyHash, input.password);
    throw new AppError("UNAUTHENTICATED", "Email or password is incorrect");
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw new AppError("UNAUTHENTICATED", "Email or password is incorrect");
  if (user.status !== "active") throw new AppError("FORBIDDEN", "This account is not active");
  const token = await createSession(db, user.id, userAgent);
  await audit(db, { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id });
  return { token, userId: user.id };
}

export async function getActorBySessionToken(db: Executor, token: string | undefined | null): Promise<Actor | null> {
  if (!token || token.length > 100) return null;
  const rows = await db
    .select({ user: users, capability: userCapabilities.capability })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userCapabilities, eq(userCapabilities.userId, users.id))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date()), eq(users.status, "active")));
  if (rows.length === 0) return null;
  const u = rows[0].user;
  return {
    userId: u.id,
    email: u.email,
    displayName: u.displayName,
    capabilities: rows.map((r) => r.capability).filter((c): c is Capability => !!c),
    activeMode: u.activeMode,
    emailVerified: !!u.emailVerifiedAt,
  };
}

export async function logout(db: Executor, token: string | undefined | null) {
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function verifyEmail(db: DB, token: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailTokens.tokenHash, sha256(token)),
          eq(emailTokens.purpose, "verify_email"),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!row) throw new AppError("VALIDATION", "This verification link is invalid or has expired");
    await tx
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`, updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    await audit(tx, { actorId: row.userId, action: "auth.email_verified", entityType: "user", entityId: row.userId });
    return { userId: row.userId };
  });
}

export async function resendVerification(db: DB, actor: Actor) {
  if (actor.emailVerified) return { alreadyVerified: true };
  await sendVerification(db, { id: actor.userId, email: actor.email, displayName: actor.displayName });
  return { alreadyVerified: false };
}

/** Always succeeds from the caller's point of view, so it can't be used to discover accounts. */
export async function requestPasswordReset(db: DB, rawEmail: string) {
  const email = String(rawEmail ?? "").trim().toLowerCase();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!user || user.status !== "active") return;
  const { token, id } = await issueEmailToken(db, user.id, "reset_password");
  await enqueueEmail(db, {
    to: user.email,
    template: "reset_password",
    subject: "Reset your WorkSpring password",
    body: `Hi ${user.displayName},\n\nUse this link to choose a new password (valid for 1 hour):\n${appUrl()}/reset-password?token=${token}\n\nIf you didn't ask for this, you can ignore this email; your password is unchanged.`,
    dedupeKey: `reset_password:${id}`,
  });
}

export async function resetPassword(db: DB, raw: unknown) {
  const input = parseOrThrow(passwordResetSchema, raw);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailTokens.tokenHash, sha256(input.token)),
          eq(emailTokens.purpose, "reset_password"),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!row) throw new AppError("VALIDATION", "This reset link is invalid or has expired");
    // Possession of the emailed link also proves email ownership.
    await tx
      .update(users)
      .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`, updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId)); // sign out everywhere
    await audit(tx, { actorId: row.userId, action: "auth.password_reset", entityType: "user", entityId: row.userId });
    return { userId: row.userId };
  });
}

/** Adds the other side of the marketplace to the SAME identity (no duplicate accounts). */
export async function addCapability(db: DB, actor: Actor, cap: "client" | "freelancer") {
  await db.transaction(async (tx) => {
    await tx.insert(userCapabilities).values({ userId: actor.userId, capability: cap }).onConflictDoNothing();
    if (cap === "client") await tx.insert(clientProfiles).values({ userId: actor.userId }).onConflictDoNothing();
    await tx.update(users).set({ activeMode: cap, updatedAt: new Date() }).where(eq(users.id, actor.userId));
    await audit(tx, { actorId: actor.userId, action: "user.capability_added", entityType: "user", entityId: actor.userId, data: { cap } });
  });
}

export async function switchMode(db: Executor, actor: Actor, mode: Mode) {
  if (!actor.capabilities.includes(mode)) throw new AppError("FORBIDDEN", `Add the ${mode} capability first`);
  await db.update(users).set({ activeMode: mode, updatedAt: new Date() }).where(eq(users.id, actor.userId));
}
