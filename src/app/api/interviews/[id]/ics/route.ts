import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { jobs, proposals } from "@/db/schema";
import { isAppError } from "@/domain/errors";
import { SESSION_COOKIE } from "@/lib/session";
import { getActorBySessionToken } from "@/server/services/auth";
import { getInterview, interviewIcs } from "@/server/services/interviews";

export const dynamic = "force-dynamic";

/** Calendar invite (.ics) for a participant of the interview. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const actor = await getActorBySessionToken(db, req.cookies.get(SESSION_COOKIE)?.value);
  if (!actor) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 });
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("bad id");
    const iv = await getInterview(db, actor, id);
    const [p] = await db.select({ title: jobs.title }).from(proposals).innerJoin(jobs, eq(jobs.id, proposals.jobId)).where(eq(proposals.id, iv.proposalId));
    return new NextResponse(interviewIcs(iv, p?.title ?? "Interview"), {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="workspring-interview-${id.slice(0, 8)}.ics"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (isAppError(e) || e instanceof Error) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Interview not found" } }, { status: 404 });
    throw e;
  }
}
