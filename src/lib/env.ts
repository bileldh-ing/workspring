import { z } from "zod";

/** Validated server environment. Fails fast at boot in production with a list of what is wrong (values never printed). */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL"),
    APP_URL: z.url().default("http://localhost:3000"),
    PAYMENTS_PROVIDER: z.string().default("test"),
    TEST_PROVIDER_WEBHOOK_SECRET: z.string().optional(),
    FILE_URL_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
    STORAGE_DRIVER: z.enum(["local", "s3"]).optional(),
    STORAGE_DIR: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_ENDPOINT: z.url().optional(),
    LIVEKIT_URL: z.string().optional(),
    LIVEKIT_API_KEY: z.string().optional(),
    LIVEKIT_API_SECRET: z.string().optional(),
    RATE_LIMIT_DRIVER: z.enum(["db", "memory"]).optional(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.PAYMENTS_PROVIDER === "test" && (e.TEST_PROVIDER_WEBHOOK_SECRET ?? "").length < 32) {
      ctx.addIssue({ code: "custom", path: ["TEST_PROVIDER_WEBHOOK_SECRET"], message: "required (32+ chars) when PAYMENTS_PROVIDER=test" });
    }
    if (e.STORAGE_DRIVER === "s3" && !(e.S3_BUCKET && e.S3_REGION && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are required for STORAGE_DRIVER=s3" });
    }
    const lk = [e.LIVEKIT_URL, e.LIVEKIT_API_KEY, e.LIVEKIT_API_SECRET].filter(Boolean).length;
    if (lk !== 0 && lk !== 3) ctx.addIssue({ code: "custom", path: ["LIVEKIT_URL"], message: "set all of LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET or none" });
    if (e.NODE_ENV === "production" && !e.FILE_URL_SECRET) {
      ctx.addIssue({ code: "custom", path: ["FILE_URL_SECRET"], message: "required in production (signs private download URLs)" });
    }
  });

export type Env = z.infer<typeof schema>;

export function validateEnv(env: NodeJS.ProcessEnv = process.env): { ok: true; env: Env } | { ok: false; problems: string[] } {
  const r = schema.safeParse(env);
  if (r.success) return { ok: true, env: r.data };
  return { ok: false, problems: r.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`) };
}
