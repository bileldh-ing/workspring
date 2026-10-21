import { z } from "zod";
import { AppError } from "./errors";
import { CURRENCIES } from "./money";

const currency = z.enum(Object.keys(CURRENCIES) as [keyof typeof CURRENCIES, ...(keyof typeof CURRENCIES)[]]);
const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
const amount = z.string().trim().min(1, "Enter an amount");

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(10, "Use at least 10 characters").max(200, "Password is too long"),
  displayName: trimmed(2, 80, "Name"),
  intent: z.enum(["hire", "work"], { error: "Choose how you want to start" }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password").max(200),
});

export const passwordResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export const freelancerProfileSchema = z.object({
  title: trimmed(5, 120, "Headline"),
  overview: trimmed(50, 5000, "Overview"),
  hourlyRate: amount,
  currency,
  timezone: trimmed(1, 64, "Time zone"),
  availability: z.enum(["available", "limited", "unavailable"]),
  experienceLevel: z.enum(["entry", "intermediate", "expert"]),
  categorySlug: z.string().trim().min(1, "Choose a category"),
  skills: z.array(z.string().trim().min(1)).min(1, "Pick at least one skill").max(15, "Pick at most 15 skills"),
});

export const jobSchema = z
  .object({
    title: trimmed(10, 120, "Title"),
    description: trimmed(50, 10000, "Description"),
    categorySlug: z.string().trim().min(1, "Choose a category"),
    skills: z.array(z.string().trim().min(1)).min(1, "Pick at least one skill").max(10, "Pick at most 10 skills"),
    contractType: z.enum(["fixed", "hourly"]),
    currency,
    budgetMin: z.string().trim().optional(),
    budgetMax: amount,
    scope: z.enum(["small", "medium", "large"]),
    experienceLevel: z.enum(["entry", "intermediate", "expert"]),
    locationNote: z.string().trim().max(200).optional(),
  })
  .refine((v) => !CONTACT_RE.test(v.description), {
    path: ["description"],
    message: "Remove email addresses or phone numbers: share contact details only after a contract starts",
  });

/** Heuristic only (documented): catches obvious emails and long phone-number-like digit runs. */
export const CONTACT_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\s-]?){9,}/i;

export const proposalSchema = z.object({
  jobId: z.uuid(),
  coverLetter: trimmed(50, 5000, "Cover letter"),
  amount,
  durationEstimate: z.enum(["less_than_1_week", "1_to_4_weeks", "1_to_3_months", "3_plus_months"]),
});

export const declineSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const milestoneInput = z.object({
  title: trimmed(3, 120, "Milestone title"),
  amount,
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const offerSchema = z.object({
  proposalId: z.uuid(),
  title: trimmed(5, 120, "Contract title"),
  description: trimmed(20, 5000, "Scope"),
  milestones: z.array(milestoneInput).min(1, "Add at least one milestone").max(10, "At most 10 milestones"),
});

export const messageSchema = z.object({ body: trimmed(1, 5000, "Message") });
export const deliverySchema = z.object({ note: trimmed(10, 5000, "Delivery note") });
export const revisionSchema = z.object({ note: trimmed(10, 2000, "Revision request") });

export const jobSearchSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  category: z.string().trim().max(64).optional().default(""),
  skill: z.string().trim().max(64).optional().default(""),
  type: z.enum(["", "fixed", "hourly"]).optional().default(""),
  level: z.enum(["", "entry", "intermediate", "expert"]).optional().default(""),
  minBudget: z.coerce.number().int().min(0).max(1_000_000).optional(),
  sort: z.enum(["relevance", "newest", "budget_desc"]).optional().default("relevance"),
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
});
export type JobSearch = z.infer<typeof jobSearchSchema>;

export const talentSearchSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  skill: z.string().trim().max(64).optional().default(""),
  level: z.enum(["", "entry", "intermediate", "expert"]).optional().default(""),
  maxRate: z.coerce.number().int().min(0).max(100_000).optional(),
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
});
export type TalentSearch = z.infer<typeof talentSearchSchema>;

/** Parses input with a zod schema, throwing a VALIDATION AppError with per-field messages. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  throw new AppError("VALIDATION", Object.values(fieldErrors)[0] ?? "Invalid input", fieldErrors);
}
