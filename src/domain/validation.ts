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
    screeningQuestions: z.array(z.string().trim().min(5, "Questions need at least 5 characters").max(300)).max(5, "At most 5 screening questions").optional().default([]),
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
  answers: z.record(z.string(), z.string().trim().max(2000)).optional().default({}),
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

export const hourlyOfferSchema = z.object({
  proposalId: z.uuid(),
  title: trimmed(5, 120, "Contract title"),
  description: trimmed(20, 5000, "Scope"),
  hourlyRate: amount,
  weeklyLimitHours: z.coerce.number().int("Whole hours only").min(1, "At least 1 hour").max(80, "At most 80 hours"),
  allowManualTime: z.boolean().default(false),
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

const isoDateTime = z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date and time");

export const invitationSchema = z.object({
  jobId: z.uuid("Choose a job"),
  freelancerId: z.uuid(),
  message: trimmed(10, 2000, "Message"),
});

export const reportSchema = z.object({
  targetType: z.enum(["user", "job", "message", "service", "review"]),
  targetId: z.uuid(),
  reason: z.enum(["spam", "scam_or_fraud", "harassment", "fake_profile", "inappropriate", "malicious_file", "off_platform_payment", "other"]),
  details: z.string().trim().max(2000).optional(),
});

export const interviewSchema = z.object({
  proposalId: z.uuid(),
  startsAt: isoDateTime,
  durationMinutes: z.coerce.number().int().min(15, "At least 15 minutes").max(180, "At most 3 hours"),
  agenda: z.string().trim().max(1000).optional(),
});

export const manualTimeSchema = z.object({
  contractId: z.uuid(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  minutes: z.coerce.number().int("Whole minutes").min(1, "At least 1 minute").max(1440, "At most 24 hours"),
  memo: trimmed(3, 500, "Memo"),
});

export const memoSchema = z.object({ memo: z.string().trim().max(500).default("") });

const tierInput = z.object({
  name: trimmed(2, 60, "Tier name"),
  description: trimmed(10, 1000, "Tier description"),
  price: amount,
  deliveryDays: z.coerce.number().int().min(1, "At least 1 day").max(90, "At most 90 days"),
  revisions: z.coerce.number().int().min(0).max(10, "At most 10 revisions"),
});

export const serviceSchema = z.object({
  title: trimmed(10, 120, "Title"),
  categorySlug: z.string().trim().min(1, "Choose a category"),
  summary: trimmed(20, 300, "Summary"),
  description: trimmed(50, 8000, "Description"),
  currency,
  maxConcurrentOrders: z.coerce.number().int().min(1).max(50).default(3),
  tiers: z.object({ starter: tierInput, standard: tierInput, advanced: tierInput }),
  addons: z.array(z.object({ name: trimmed(2, 80, "Add-on name"), price: amount, extraDays: z.coerce.number().int().min(0).max(30).default(0) })).max(5).default([]),
  requirements: z.array(trimmed(5, 300, "Requirement")).max(8).default([]),
}).refine((v) => !CONTACT_RE.test(v.description), { path: ["description"], message: "Remove email addresses or phone numbers" });

export const orderSchema = z.object({
  listingId: z.uuid(),
  tier: z.enum(["starter", "standard", "advanced"]),
  addonIds: z.array(z.uuid()).max(5).default([]),
});

export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose 1–5 stars").max(5, "Choose 1–5 stars"),
  body: trimmed(10, 2000, "Review"),
});

export const agencySchema = z.object({
  name: trimmed(3, 80, "Agency name"),
  description: trimmed(30, 3000, "Description"),
});

export const ticketSchema = z.object({
  subject: trimmed(5, 150, "Subject"),
  category: z.enum(["account", "payments", "contract", "safety", "technical", "other"]),
  body: trimmed(10, 5000, "Message"),
});

export const disputeSchema = z.object({ milestoneId: z.uuid(), reason: trimmed(20, 3000, "Reason") });
export const resolutionSchema = z.object({ note: trimmed(10, 2000, "Resolution note") });

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
