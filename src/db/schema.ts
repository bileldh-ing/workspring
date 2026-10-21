import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" });

// ---------- enums ----------
export const capabilityEnum = pgEnum("capability", ["client", "freelancer", "admin"]);
export const modeEnum = pgEnum("workspace_mode", ["client", "freelancer"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const tokenPurposeEnum = pgEnum("token_purpose", ["verify_email", "reset_password"]);
export const outboxStatusEnum = pgEnum("outbox_status", ["queued", "sent", "failed"]);
export const profileStatusEnum = pgEnum("profile_status", ["draft", "published", "hidden"]);
export const availabilityEnum = pgEnum("availability", ["available", "limited", "unavailable"]);
export const experienceEnum = pgEnum("experience_level", ["entry", "intermediate", "expert"]);
export const contractTypeEnum = pgEnum("contract_type", ["fixed", "hourly"]);
export const jobScopeEnum = pgEnum("job_scope", ["small", "medium", "large"]);
export const jobStatusEnum = pgEnum("job_status", ["draft", "open", "paused", "closed"]);
export const proposalStatusEnum = pgEnum("proposal_status", [
  "submitted",
  "shortlisted",
  "declined",
  "withdrawn",
  "offer_sent",
  "hired",
]);
export const offerStatusEnum = pgEnum("offer_status", ["sent", "accepted", "declined", "withdrawn", "expired"]);
export const contractStatusEnum = pgEnum("contract_status", ["active", "paused", "completed", "canceled"]);
export const milestoneStatusEnum = pgEnum("milestone_status", [
  "unfunded",
  "funding_pending",
  "funded",
  "submitted",
  "revision_requested",
  "approved",
  "release_pending",
  "released",
  "canceled",
]);
export const paymentPurposeEnum = pgEnum("payment_purpose", ["milestone_funding", "milestone_release"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "requires_action",
  "processing",
  "succeeded",
  "failed",
  "canceled",
]);
export const paymentModeEnum = pgEnum("payment_mode", ["test", "live"]);
export const ledgerDirectionEnum = pgEnum("ledger_direction", ["debit", "credit"]);
export const memberRoleEnum = pgEnum("conversation_role", ["owner", "member"]);

// ---------- identity ----------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    status: userStatusEnum("status").notNull().default("active"),
    activeMode: modeEnum("active_mode").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const userCapabilities = pgTable(
  "user_capabilities",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    capability: capabilityEnum("capability").notNull(),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.capability] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token) hex; raw token only lives in the cookie
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const emailTokens = pgTable(
  "email_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: tokenPurposeEnum("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_tokens_hash_uq").on(t.tokenHash), index("email_tokens_user_idx").on(t.userId)],
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toEmail: text("to_email").notNull(),
    template: text("template").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: outboxStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [uniqueIndex("email_outbox_dedupe_uq").on(t.dedupeKey), index("email_outbox_status_idx").on(t.status)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_actor_idx").on(t.actorId)],
);

// ---------- taxonomy ----------
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
  },
  (t) => [index("skills_category_idx").on(t.categoryId)],
);

// ---------- profiles ----------
export const freelancerProfiles = pgTable(
  "freelancer_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    overview: text("overview").notNull(),
    hourlyRateMinor: money("hourly_rate_minor"),
    currency: text("currency").notNull().default("USD"),
    timezone: text("timezone").notNull().default("UTC"),
    availability: availabilityEnum("availability").notNull().default("available"),
    experienceLevel: experienceEnum("experience_level").notNull().default("intermediate"),
    categoryId: uuid("category_id").references(() => categories.id),
    status: profileStatusEnum("status").notNull().default("draft"),
    publishedAt: ts("published_at"),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(overview, '')), 'B')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("freelancer_profiles_status_idx").on(t.status),
    index("freelancer_profiles_tsv_idx").using("gin", t.searchTsv),
    check("fp_rate_positive", sql`${t.hourlyRateMinor} is null or ${t.hourlyRateMinor} > 0`),
  ],
);

export const profileSkills = pgTable(
  "profile_skills",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => freelancerProfiles.userId, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] }), index("profile_skills_skill_idx").on(t.skillId)],
);

export const clientProfiles = pgTable("client_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  companyName: text("company_name"),
  about: text("about"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------- jobs ----------
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => users.id),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    contractType: contractTypeEnum("contract_type").notNull(),
    budgetMinMinor: money("budget_min_minor"),
    budgetMaxMinor: money("budget_max_minor"),
    currency: text("currency").notNull().default("USD"),
    scope: jobScopeEnum("scope").notNull(),
    experienceLevel: experienceEnum("experience_level").notNull(),
    locationNote: text("location_note"),
    status: jobStatusEnum("status").notNull().default("draft"),
    publishedAt: ts("published_at"),
    closedAt: ts("closed_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_client_idx").on(t.clientId),
    index("jobs_status_published_idx").on(t.status, t.publishedAt),
    index("jobs_category_idx").on(t.categoryId),
    index("jobs_tsv_idx").using("gin", t.searchTsv),
    check("jobs_budget_nonneg", sql`(${t.budgetMinMinor} is null or ${t.budgetMinMinor} > 0) and (${t.budgetMaxMinor} is null or ${t.budgetMaxMinor} > 0)`),
    check(
      "jobs_budget_order",
      sql`${t.budgetMinMinor} is null or ${t.budgetMaxMinor} is null or ${t.budgetMinMinor} <= ${t.budgetMaxMinor}`,
    ),
  ],
);

export const jobSkills = pgTable(
  "job_skills",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.skillId] }), index("job_skills_skill_idx").on(t.skillId)],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId)],
);

// ---------- proposals ----------
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    freelancerId: uuid("freelancer_id")
      .notNull()
      .references(() => users.id),
    coverLetter: text("cover_letter").notNull(),
    rateType: contractTypeEnum("rate_type").notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    durationEstimate: text("duration_estimate").notNull(),
    status: proposalStatusEnum("status").notNull().default("submitted"),
    termsSnapshot: jsonb("terms_snapshot").$type<Record<string, unknown>>().notNull(),
    declineReason: text("decline_reason"),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    withdrawnAt: ts("withdrawn_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("proposals_job_idx").on(t.jobId, t.status),
    index("proposals_freelancer_idx").on(t.freelancerId, t.status),
    uniqueIndex("proposals_one_active_per_job_uq")
      .on(t.jobId, t.freelancerId)
      .where(sql`${t.status} <> 'withdrawn'`),
    check("proposals_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

export const proposalEvents = pgTable(
  "proposal_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("proposal_events_proposal_idx").on(t.proposalId)],
);

// ---------- messaging ----------
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").references(() => jobs.id),
    proposalId: uuid("proposal_id").references(() => proposals.id),
    subject: text("subject").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    lastMessageAt: ts("last_message_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("conversations_proposal_uq").on(t.proposalId)],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: memberRoleEnum("role").notNull().default("member"),
    lastReadAt: ts("last_read_at"),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("conversation_members_user_idx").on(t.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

// ---------- offers & contracts ----------
export const platformFeeRules = pgTable("platform_fee_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull().unique(),
  freelancerFeeBps: integer("freelancer_fee_bps").notNull(),
  clientFeeBps: integer("client_fee_bps").notNull(),
  description: text("description").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  activeFrom: ts("active_from").notNull().defaultNow(),
  createdAt: createdAt(),
});

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => users.id),
    freelancerId: uuid("freelancer_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    contractType: contractTypeEnum("contract_type").notNull(),
    currency: text("currency").notNull(),
    totalMinor: money("total_minor").notNull(),
    status: offerStatusEnum("status").notNull().default("sent"),
    termsSnapshot: jsonb("terms_snapshot").$type<Record<string, unknown>>().notNull(),
    feeRuleId: uuid("fee_rule_id")
      .notNull()
      .references(() => platformFeeRules.id),
    expiresAt: ts("expires_at").notNull(),
    respondedAt: ts("responded_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("offers_freelancer_idx").on(t.freelancerId, t.status),
    index("offers_client_idx").on(t.clientId, t.status),
    uniqueIndex("offers_one_open_per_proposal_uq")
      .on(t.proposalId)
      .where(sql`${t.status} = 'sent'`),
    check("offers_total_positive", sql`${t.totalMinor} > 0`),
  ],
);

export const offerEvents = pgTable(
  "offer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("offer_events_offer_idx").on(t.offerId)],
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => users.id),
    freelancerId: uuid("freelancer_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    contractType: contractTypeEnum("contract_type").notNull(),
    currency: text("currency").notNull(),
    totalMinor: money("total_minor").notNull(),
    status: contractStatusEnum("status").notNull().default("active"),
    termsSnapshot: jsonb("terms_snapshot").$type<Record<string, unknown>>().notNull(),
    feeRuleSnapshot: jsonb("fee_rule_snapshot").$type<Record<string, unknown>>().notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("contracts_offer_uq").on(t.offerId),
    // R1 jobs hire exactly one freelancer: at most one live contract per job.
    uniqueIndex("contracts_one_live_per_job_uq")
      .on(t.jobId)
      .where(sql`${t.status} in ('active', 'paused')`),
    index("contracts_client_idx").on(t.clientId),
    index("contracts_freelancer_idx").on(t.freelancerId),
  ],
);

export const contractEvents = pgTable(
  "contract_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("contract_events_contract_idx").on(t.contractId, t.createdAt)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    dueDate: text("due_date"),
    status: milestoneStatusEnum("status").notNull().default("unfunded"),
    fundedAt: ts("funded_at"),
    approvedAt: ts("approved_at"),
    releasedAt: ts("released_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("milestones_contract_seq_uq").on(t.contractId, t.seq),
    check("milestones_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

export const milestoneSubmissions = pgTable(
  "milestone_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    note: text("note").notNull(),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("milestone_submissions_version_uq").on(t.milestoneId, t.version)],
);

export const revisionRequests = pgTable("revision_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => milestoneSubmissions.id),
  note: text("note").notNull(),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const milestoneEvents = pgTable(
  "milestone_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    actorKind: text("actor_kind").notNull().default("user"), // user | provider_webhook | system
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("milestone_events_milestone_idx").on(t.milestoneId, t.createdAt)],
);

// ---------- payments & ledger ----------
export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    mode: paymentModeEnum("mode").notNull(),
    providerRef: text("provider_ref"),
    purpose: paymentPurposeEnum("purpose").notNull(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id),
    amountMinor: money("amount_minor").notNull(),
    feeMinor: money("fee_minor").notNull().default(0),
    currency: text("currency").notNull(),
    status: paymentStatusEnum("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    failureReason: text("failure_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payment_intents_idem_uq").on(t.idempotencyKey),
    uniqueIndex("payment_intents_provider_ref_uq").on(t.provider, t.providerRef),
    index("payment_intents_milestone_idx").on(t.milestoneId),
    check("payment_intents_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

export const providerWebhookEvents = pgTable(
  "provider_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    outcome: text("outcome").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provider_webhook_events_uq").on(t.provider, t.eventId)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id").notNull(),
    account: text("account").notNull(),
    direction: ledgerDirectionEnum("direction").notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    mode: paymentModeEnum("mode").notNull(),
    contractId: uuid("contract_id").references(() => contracts.id),
    milestoneId: uuid("milestone_id").references(() => milestones.id),
    paymentIntentId: uuid("payment_intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    memo: text("memo").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_tx_idx").on(t.transactionId),
    index("ledger_contract_idx").on(t.contractId),
    // Defence in depth against double-posting the same provider outcome.
    uniqueIndex("ledger_intent_account_dir_uq").on(t.paymentIntentId, t.account, t.direction),
    check("ledger_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);
