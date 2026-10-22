import { createHmac, timingSafeEqual } from "node:crypto";
import { createLocalStorage } from "./local";
import { createS3Storage, s3ConfigFromEnv } from "./s3";

/** Private object storage. Objects are never publicly addressable; downloads go through an authorized, signed route. */
export interface StorageAdapter {
  readonly id: "local" | "s3";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;
  const s3 = s3ConfigFromEnv();
  if ((process.env.STORAGE_DRIVER ?? (s3 ? "s3" : "local")) === "s3") {
    if (!s3) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
    cached = createS3Storage(s3);
  } else {
    cached = createLocalStorage(process.env.STORAGE_DIR ?? ".storage");
  }
  return cached;
}

export function setStorageForTests(s: StorageAdapter | null) {
  cached = s;
}

export const DOWNLOAD_TTL_SECONDS = 300;

function signingSecret() {
  const s = process.env.FILE_URL_SECRET ?? process.env.SESSION_SECRET ?? process.env.TEST_PROVIDER_WEBHOOK_SECRET ?? "";
  if (s.length < 32) throw new Error("FILE_URL_SECRET must be set (32+ chars) to sign download URLs");
  return s;
}

/** HMAC-signed, short-lived download URL bound to the file AND the requesting user. */
export function signDownload(fileId: string, userId: string, now = Math.floor(Date.now() / 1000)) {
  const exp = now + DOWNLOAD_TTL_SECONDS;
  const sig = createHmac("sha256", signingSecret()).update(`${fileId}.${userId}.${exp}`).digest("base64url");
  return `/api/files/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyDownload(fileId: string, userId: string, exp: string | null, sig: string | null, now = Math.floor(Date.now() / 1000)) {
  const e = Number(exp);
  if (!sig || !Number.isInteger(e) || e < now || e > now + DOWNLOAD_TTL_SECONDS + 5) return false;
  const expected = Buffer.from(createHmac("sha256", signingSecret()).update(`${fileId}.${userId}.${e}`).digest("base64url"));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
