import { getDb } from "@/db/client";
import { api, jsonBody } from "@/lib/api";
import { setSessionCookie } from "@/lib/session";
import { login } from "@/server/services/auth";

export const POST = api(async ({ req }) => {
  const { token, userId } = await login(getDb(), await jsonBody(req), req.headers.get("user-agent"));
  await setSessionCookie(token);
  return { userId };
}, { auth: false });
