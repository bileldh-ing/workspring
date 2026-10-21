import { getDb } from "@/db/client";
import { api } from "@/lib/api";
import { processWebhook } from "@/server/services/payments";

export const dynamic = "force-dynamic";

/**
 * Provider webhook endpoint. No session and no CSRF origin check (server-to-server); authenticity comes
 * solely from the provider signature, verified over the RAW body before any processing.
 */
export const POST = api<{ provider: string }>(
  async ({ req, params }) => {
    if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) return new Response("payload too large", { status: 413 });
    const raw = await req.text();
    return processWebhook(getDb(), params.provider, raw, req.headers);
  },
  { auth: false, csrf: false },
);
