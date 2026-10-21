/** Drizzle wraps driver errors (DrizzleQueryError.cause); look through the chain for a Postgres error. */
export function pgError(e: unknown): { code?: string; constraint_name?: string } | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const c = cur as { code?: string; constraint_name?: string; cause?: unknown };
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

export function isUniqueViolation(e: unknown, constraint?: string) {
  const p = pgError(e);
  return p?.code === "23505" && (!constraint || p.constraint_name === constraint);
}

export const isSerializationFailure = (e: unknown) => ["40001", "40P01"].includes(pgError(e)?.code ?? "");
