import { getDb } from "@/db/client";
import { api, jsonBody } from "@/lib/api";
import { setSessionCookie } from "@/lib/session";
import { login, register } from "@/server/services/auth";

export const POST = api(async ({ req }) => {
  const body = (await jsonBody(req)) as Record<string, unknown>;
  const { userId } = await register(getDb(), body);
  const { token } = await login(getDb(), { email: body.email, password: body.password }, req.headers.get("user-agent"));
  await setSessionCookie(token);
  return { userId, emailVerificationRequired: true };
}, { auth: false });
