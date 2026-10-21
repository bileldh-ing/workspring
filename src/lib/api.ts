import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { AppError, errorEnvelope, isAppError } from "@/domain/errors";
import type { Actor } from "@/domain/permissions";
import { getActorBySessionToken } from "@/server/services/auth";
import { SESSION_COOKIE } from "./session";

type Ctx<P> = { params: Promise<P> };

/** CSRF defence for cookie-authenticated JSON mutations: require a same-origin Origin header. */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new AppError("FORBIDDEN", "Cross-origin request rejected");
}

export function api<P = Record<string, string>>(
  handler: (args: { req: NextRequest; params: P; actor: Actor | null }) => Promise<unknown>,
  opts: { auth?: boolean; csrf?: boolean } = {},
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      if (opts.csrf !== false) assertSameOrigin(req);
      const actor = await getActorBySessionToken(getDb(), req.cookies.get(SESSION_COOKIE)?.value);
      if (opts.auth !== false && !actor) throw new AppError("UNAUTHENTICATED", "Sign in required");
      const data = await handler({ req, params: await ctx.params, actor });
      return data instanceof Response ? data : NextResponse.json({ data });
    } catch (e) {
      if (isAppError(e)) return NextResponse.json(errorEnvelope(e), { status: e.status });
      console.error("[api] unhandled error", { path: req.nextUrl.pathname, error: e instanceof Error ? e.message : "unknown" });
      return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
    }
  };
}

export async function jsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION", "Request body must be JSON");
  }
}
