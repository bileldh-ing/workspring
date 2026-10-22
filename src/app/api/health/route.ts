import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness: the process is up and serving. No dependencies are touched (safe for frequent probes). */
export async function GET() {
  return NextResponse.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()), version: process.env.APP_VERSION ?? "dev" });
}
