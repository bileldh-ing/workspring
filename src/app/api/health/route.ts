import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getPaymentProvider } from "@/server/payments";

export const dynamic = "force-dynamic";

/** Liveness + readiness: checks the database and reports the payment provider state (no secrets). */
export async function GET() {
  const p = getPaymentProvider();
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "ok", payments: { provider: p.id, mode: p.mode, configured: p.configured } });
  } catch {
    return NextResponse.json({ status: "degraded", db: "unavailable" }, { status: 503 });
  }
}
