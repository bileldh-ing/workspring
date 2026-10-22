/**
 * Structured JSON logger with PII scrubbing. Never pass passwords, tokens or message bodies; the scrubber is a
 * second line of defence that masks emails, bearer/session tokens, card-like numbers and long secrets.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEYS = /pass(word)?|secret|token|authorization|cookie|session|card|cvv|iban|body|signature/i;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") {
    return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/\b(?:\d[ -]?){13,19}\b/g, "[number]")
      .replace(/(bearer\s+)[\w.-]+/gi, "$1[token]")
      .replace(/\b[a-f0-9]{40,}\b/gi, "[hex]");
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: scrub(value.message, depth + 1) };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? "[redacted]" : scrub(v, depth + 1)]));
  }
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const min = (process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === "test" ? "warn" : "info");
  if (ORDER[level] < (ORDER[min] ?? 20)) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: scrub(msg), ...(fields ? (scrub(fields) as object) : {}) });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};
