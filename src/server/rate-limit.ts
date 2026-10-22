import { sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { AppError } from "@/domain/errors";

/**
 * Fixed-window rate limiter. Default adapter is Postgres-backed (shared by every app instance, survives restarts);
 * RATE_LIMIT_DRIVER=memory uses a per-process map (single instance / tests).
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>;
}

export function dbRateLimiter(db: Executor): RateLimiter {
  return {
    async hit(key, limit, windowSeconds) {
      const rows = await db.execute<{ count: number; window_start: string }>(sql`
        insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
        on conflict (key) do update set
          count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
          window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
        returning count, window_start::text`);
      const count = Number(rows[0].count);
      const resetAt = new Date(new Date(rows[0].window_start).getTime() + windowSeconds * 1000);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
    },
  };
}

const mem = new Map<string, { start: number; count: number }>();
export function memoryRateLimiter(): RateLimiter {
  return {
    async hit(key, limit, windowSeconds) {
      const now = Date.now();
      const e = mem.get(key);
      const cur = e && now - e.start < windowSeconds * 1000 ? { start: e.start, count: e.count + 1 } : { start: now, count: 1 };
      mem.set(key, cur);
      if (mem.size > 50_000) mem.clear();
      return { allowed: cur.count <= limit, remaining: Math.max(0, limit - cur.count), resetAt: new Date(cur.start + windowSeconds * 1000) };
    },
  };
}

export const RATE_LIMITS = {
  login: { limit: 8, windowSeconds: 600 },
  register: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  upload: { limit: 30, windowSeconds: 600 },
  report: { limit: 10, windowSeconds: 3600 },
  api: { limit: 120, windowSeconds: 60 },
} as const;

export async function enforceRateLimit(db: Executor, bucket: keyof typeof RATE_LIMITS, subject: string) {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const limiter = process.env.RATE_LIMIT_DRIVER === "memory" ? memoryRateLimiter() : dbRateLimiter(db);
  const r = await limiter.hit(`${bucket}:${subject.toLowerCase().slice(0, 200)}`, limit, windowSeconds);
  if (!r.allowed) throw new AppError("RATE_LIMITED", `Too many attempts. Try again after ${r.resetAt.toISOString().slice(11, 16)} UTC.`);
  return r;
}
