import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { log } from "@/lib/logger";
import { getPaymentProvider } from "@/server/payments";
import { videoConfig } from "@/server/video/livekit";

export const dynamic = "force-dynamic";

/** Readiness: database reachable and migrated; reports provider states (never secrets). */
export async function GET() {
  const p = getPaymentProvider();
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const [m] = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return NextResponse.json({
      status: "ready",
      db: "ok",
      migrations: Number(m?.n ?? 0),
      payments: { provider: p.id, mode: p.mode, configured: p.configured },
      video: { provider: "livekit", configured: !!videoConfig() },
      storage: process.env.STORAGE_DRIVER ?? (process.env.S3_BUCKET ? "s3" : "local"),
    });
  } catch (e) {
    log.error("readiness check failed", { error: e });
    return NextResponse.json({ status: "not_ready", db: "unavailable" }, { status: 503 });
  }
}
