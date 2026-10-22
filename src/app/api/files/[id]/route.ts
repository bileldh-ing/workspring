import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { log } from "@/lib/logger";
import { SESSION_COOKIE } from "@/lib/session";
import { getActorBySessionToken } from "@/server/services/auth";
import { readAttachment } from "@/server/services/files";
import { verifyDownload } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * Private file download. Requires: a valid session, an unexpired HMAC signature bound to this file AND user,
 * and a fresh per-object authorization check. Always served as an attachment with nosniff.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const notFound = () => NextResponse.json({ error: { code: "NOT_FOUND", message: "File not found" } }, { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const actor = await getActorBySessionToken(getDb(), req.cookies.get(SESSION_COOKIE)?.value);
  if (!actor) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  if (!verifyDownload(id, actor.userId, sp.get("exp"), sp.get("sig"))) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "This download link has expired. Reload the page to get a fresh link." } }, { status: 403 });
  }
  try {
    const { row, bytes } = await readAttachment(getDb(), actor.userId, id);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (isAppError(e)) return notFound();
    log.error("file download failed", { fileId: id, error: e });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
  }
}
