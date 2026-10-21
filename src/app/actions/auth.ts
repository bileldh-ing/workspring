"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { AppError } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { runAction, str } from "@/lib/run-action";
import { clearSessionCookie, requireActor, safeNext, sessionToken, setSessionCookie, userAgent } from "@/lib/session";
import * as auth from "@/server/services/auth";

// Simple per-process login throttle (documented limitation: not shared across instances).
const attempts = new Map<string, { n: number; until: number }>();
function throttle(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 8) throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Try again in a few minutes.");
  attempts.set(key, a && a.until > now ? { n: a.n + 1, until: a.until } : { n: 1, until: now + 10 * 60_000 });
}

export async function registerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const db = getDb();
    const input = { email: str(fd, "email"), password: str(fd, "password"), displayName: str(fd, "displayName"), intent: str(fd, "intent") };
    await auth.register(db, input);
    const { token } = await auth.login(db, { email: input.email, password: input.password }, await userAgent());
    await setSessionCookie(token);
    redirect(input.intent === "work" ? "/app/profile?welcome=1" : "/app?welcome=1");
  });
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    throttle(str(fd, "email").toLowerCase());
    const { token } = await auth.login(getDb(), { email: str(fd, "email"), password: str(fd, "password") }, await userAgent());
    await setSessionCookie(token);
    redirect(safeNext(str(fd, "next")));
  });
}

export async function logoutAction() {
  await auth.logout(getDb(), await sessionToken());
  await clearSessionCookie();
  redirect("/");
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await auth.requestPasswordReset(getDb(), str(fd, "email"));
    return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    if (str(fd, "password") !== str(fd, "confirm")) throw new AppError("VALIDATION", "Passwords don't match");
    await auth.resetPassword(getDb(), { token: str(fd, "token"), password: str(fd, "password") });
    redirect("/signin?reset=1");
  });
}

export async function resendVerificationAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const r = await auth.resendVerification(getDb(), await requireActor());
    return { ok: true, message: r.alreadyVerified ? "Your email is already verified." : "Verification email queued." };
  });
}

export async function addCapabilityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const cap = str(fd, "capability");
    if (cap !== "client" && cap !== "freelancer") throw new AppError("VALIDATION", "Unknown capability");
    await auth.addCapability(getDb(), await requireActor(), cap);
    redirect(cap === "freelancer" ? "/app/profile" : "/app");
  });
}

export async function switchModeAction(fd: FormData) {
  const mode = str(fd, "mode");
  const actor = await requireActor();
  if (mode === "client" || mode === "freelancer") {
    try {
      await auth.switchMode(getDb(), actor, mode);
    } catch {
      redirect("/app/settings?error=capability");
    }
  }
  redirect("/app");
}
