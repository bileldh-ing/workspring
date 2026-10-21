import { desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox, sessions, userCapabilities, users } from "@/db/schema";
import {
  addCapability,
  getActorBySessionToken,
  getActorByUserId,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  switchMode,
  verifyEmail,
} from "@/server/services/auth";
import { closeTestDb, resetDb, testDb } from "../helpers";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb());

const tokenFrom = (body: string, path: string) => new URL(body.match(new RegExp(`http\\S+${path}\\S+`))![0]).searchParams.get("token")!;

describe("account lifecycle (real Postgres)", () => {
  it("register → verification email in outbox → verify → login → session → logout", async () => {
    const { userId } = await register(db, { email: "Ana@Example.test", password: "a-long-password-1", displayName: "Ana", intent: "work" });
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.emailVerifiedAt).toBeNull();
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, "ana@example.test"));
    expect(mail.template).toBe("verify_email");

    await verifyEmail(db, tokenFrom(mail.bodyText, "verify-email"));
    await expect(verifyEmail(db, tokenFrom(mail.bodyText, "verify-email"))).rejects.toThrow(/invalid or has expired/); // single use

    await expect(login(db, { email: "ana@example.test", password: "wrong-password" })).rejects.toThrow(/incorrect/);
    await expect(login(db, { email: "nobody@example.test", password: "whatever-123" })).rejects.toThrow(/incorrect/);
    const { token } = await login(db, { email: "ANA@example.test", password: "a-long-password-1" });
    const [s] = await db.select().from(sessions);
    expect(s.id).not.toBe(token); // only the hash is stored
    const actor = await getActorBySessionToken(db, token);
    expect(actor).toMatchObject({ userId, emailVerified: true, capabilities: ["freelancer"], activeMode: "freelancer" });
    await logout(db, token);
    expect(await getActorBySessionToken(db, token)).toBeNull();
  });

  it("rejects duplicate emails case-insensitively", async () => {
    await register(db, { email: "dup@example.test", password: "a-long-password-1", displayName: "One", intent: "hire" });
    await expect(register(db, { email: "DUP@example.test", password: "a-long-password-1", displayName: "Two", intent: "work" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("password reset is single-use and signs out every session", async () => {
    await register(db, { email: "r@example.test", password: "a-long-password-1", displayName: "Rami", intent: "hire" });
    const { token } = await login(db, { email: "r@example.test", password: "a-long-password-1" });
    await requestPasswordReset(db, "r@example.test");
    await requestPasswordReset(db, "unknown@example.test"); // silently ignored (no enumeration)
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.template, "reset_password")).orderBy(desc(emailOutbox.createdAt));
    const t = tokenFrom(mail.bodyText, "reset-password");
    await resetPassword(db, { token: t, password: "a-brand-new-password" });
    expect(await getActorBySessionToken(db, token)).toBeNull();
    await expect(resetPassword(db, { token: t, password: "another-password-9" })).rejects.toThrow(/invalid/);
    await expect(login(db, { email: "r@example.test", password: "a-long-password-1" })).rejects.toThrow();
    await expect(login(db, { email: "r@example.test", password: "a-brand-new-password" })).resolves.toHaveProperty("token");
  });

  it("one identity gains the second capability and switches mode without a duplicate account", async () => {
    const { userId } = await register(db, { email: "both@example.test", password: "a-long-password-1", displayName: "Both", intent: "hire" });
    let actor = (await getActorByUserId(db, userId))!;
    await expect(switchMode(db, actor, "freelancer")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await addCapability(db, actor, "freelancer");
    actor = (await getActorByUserId(db, userId))!;
    expect(actor.capabilities.sort()).toEqual(["client", "freelancer"]);
    expect(actor.activeMode).toBe("freelancer");
    await switchMode(db, actor, "client");
    expect((await getActorByUserId(db, userId))!.activeMode).toBe("client");
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(userCapabilities)).toHaveLength(2);
  });
});
