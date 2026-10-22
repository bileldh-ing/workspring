import { createHmac } from "node:crypto";

/**
 * LiveKit access tokens (HS256 JWT with a `video` grant), signed server-side only after permission checks.
 * Gated: the provider is "configured" only when LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are set.
 */
export type VideoConfig = { url: string; apiKey: string; apiSecret: string };

export function videoConfig(): VideoConfig | null {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return null;
  return { url: LIVEKIT_URL, apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export function signLiveKitToken(cfg: VideoConfig, input: { identity: string; name: string; room: string; ttlSeconds?: number; now?: number }) {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(input.ttlSeconds ?? 3600, 4 * 3600);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: cfg.apiKey,
    sub: input.identity,
    name: input.name,
    nbf: now - 10,
    exp: now + ttl,
    // Scoped grant: join this one room only; no room admin, no recording.
    video: { room: input.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: false, roomRecord: false },
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", cfg.apiSecret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}
