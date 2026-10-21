import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";

// Argon2id (library default algorithm) with OWASP-recommended minimums: m=19 MiB, t=2, p=1.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = async (stored: string, pw: string) => {
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
};

/** 32 random bytes, base64url. Raw value goes to the user (cookie/email link); only its hash is stored. */
export const randomToken = () => randomBytes(32).toString("base64url");
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
