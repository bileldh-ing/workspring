import { createHash, createHmac } from "node:crypto";
import type { StorageAdapter } from "./index";

export type S3Config = { bucket: string; region: string; accessKeyId: string; secretAccessKey: string; endpoint?: string };

export function s3ConfigFromEnv(): S3Config | null {
  const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT } = process.env;
  if (!S3_BUCKET || !S3_REGION || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return { bucket: S3_BUCKET, region: S3_REGION, accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY, endpoint: S3_ENDPOINT };
}

const sha256hex = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const hmac = (k: string | Buffer, d: string) => createHmac("sha256", k).update(d).digest();

/** AWS Signature V4 header signing for a single path-style request (exported for unit tests). */
export function signV4(input: { method: string; url: URL; region: string; accessKeyId: string; secretAccessKey: string; body: Uint8Array | string; now?: Date; contentType?: string }): Record<string, string> {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256hex(input.body);
  const headers: Record<string, string> = { host: input.url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (input.contentType) headers["content-type"] = input.contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join("");
  const canonicalRequest = [input.method, input.url.pathname, input.url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

/**
 * S3-compatible adapter (AWS S3, Cloudflare R2, MinIO) using path-style URLs and SigV4. The bucket must be private.
 * NOTE: unit-tested for request signing shape only; not exercised against a live bucket in this repository's CI.
 */
export function createS3Storage(cfg: S3Config): StorageAdapter {
  const endpoint = (cfg.endpoint ?? `https://s3.${cfg.region}.amazonaws.com`).replace(/\/$/, "");
  const urlFor = (key: string) => new URL(`${endpoint}/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
  async function send(method: string, key: string, body: Uint8Array = new Uint8Array(), contentType?: string) {
    const url = urlFor(key);
    const headers = signV4({ method, url, region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, body, contentType });
    return fetch(url, { method, headers, body: method === "PUT" ? Buffer.from(body) : undefined });
  }
  return {
    id: "s3",
    async put(key, bytes, contentType) {
      const r = await send("PUT", key, bytes, contentType);
      if (!r.ok) throw new Error(`S3 put failed: ${r.status}`);
    },
    async get(key) {
      const r = await send("GET", key);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`S3 get failed: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async delete(key) {
      const r = await send("DELETE", key);
      if (!r.ok && r.status !== 404) throw new Error(`S3 delete failed: ${r.status}`);
    },
  };
}
