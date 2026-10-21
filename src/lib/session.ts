import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import type { Actor } from "@/domain/permissions";
import { getActorBySessionToken, SESSION_TTL_MS } from "@/server/services/auth";

export const SESSION_COOKIE = "ws_session";

/** Current signed-in actor (memoized per request), or null. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getActorBySessionToken(getDb(), token);
});

export async function requireActor(next?: string): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect(`/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return a;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function userAgent() {
  return (await headers()).get("user-agent");
}

/** Only allow local, path-only redirect targets (prevents open redirects via ?next=). */
export function safeNext(next: unknown, fallback = "/app") {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : fallback;
}
