import { getDb } from "@/db/client";
import { api } from "@/lib/api";
import { clearSessionCookie, SESSION_COOKIE } from "@/lib/session";
import { logout } from "@/server/services/auth";

export const POST = api(async ({ req }) => {
  await logout(getDb(), req.cookies.get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  return { ok: true };
}, { auth: false });
