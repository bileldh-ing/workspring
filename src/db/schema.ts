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
  "disputed",
  "refund_pending",
  "refunded",
]);
export const paymentPurposeEnum = pgEnum("payment_purpose", [
  "milestone_funding",
  "milestone_release",
  "timesheet_payment",
  "order_payment",
  "order_release",
  "milestone_refund",
]);
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
    editedAt: ts("edited_at"),
    deletedAt: ts("deleted_at"),
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
    hourlyRateMinor: money("hourly_rate_minor"),
    weeklyLimitMinutes: integer("weekly_limit_minutes"),
    allowManualTime: boolean("allow_manual_time").notNull().default(false),
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
    hourlyRateMinor: money("hourly_rate_minor"),
    weeklyLimitMinutes: integer("weekly_limit_minutes"),
    allowManualTime: boolean("allow_manual_time").notNull().default(false),
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
    milestoneId: uuid("milestone_id").references(() => milestones.id),
    timesheetId: uuid("timesheet_id"),
    serviceOrderId: uuid("service_order_id"),
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
    index("payment_intents_timesheet_idx").on(t.timesheetId),
    index("payment_intents_order_idx").on(t.serviceOrderId),
    check("payment_intents_amount_positive", sql`${t.amountMinor} > 0`),
    check("payment_intents_one_target", sql`num_nonnulls(${t.milestoneId}, ${t.timesheetId}, ${t.serviceOrderId}) = 1`),
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
    serviceOrderId: uuid("service_order_id"),
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

// =====================================================================================================
// R2 additions: invitations, screening, files, notifications, safety, interviews, hourly, services,
// reviews, agencies, support, disputes, admin roles, rate limits.
// =====================================================================================================

export const invitationStatusEnum = pgEnum("invitation_status", ["sent", "accepted", "declined", "revoked", "expired"]);
export const attachmentEntityEnum = pgEnum("attachment_entity", ["proposal", "message", "milestone_submission", "order_delivery", "support_ticket", "dispute"]);
export const reportTargetEnum = pgEnum("report_target", ["user", "job", "message", "service", "review"]);
export const reportReasonEnum = pgEnum("report_reason", ["spam", "scam_or_fraud", "harassment", "fake_profile", "inappropriate", "malicious_file", "off_platform_payment", "other"]);
export const reportStatusEnum = pgEnum("report_status", ["open", "reviewing", "actioned", "dismissed"]);
export const interviewStatusEnum = pgEnum("interview_status", ["proposed", "confirmed", "declined", "canceled", "completed"]);
export const timeSourceEnum = pgEnum("time_source", ["timer", "manual"]);
export const timesheetStatusEnum = pgEnum("timesheet_status", ["submitted", "approved", "disputed", "payment_pending", "paid"]);
export const serviceStatusEnum = pgEnum("service_status", ["draft", "pending_review", "published", "changes_requested", "paused", "archived"]);
export const serviceTierEnum = pgEnum("service_tier", ["starter", "standard", "advanced"]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending_payment",
  "requirements_pending",
  "in_progress",
  "delivered",
  "revision_requested",
  "release_pending",
  "completed",
  "canceled",
]);
export const agencyRoleEnum = pgEnum("agency_role", ["owner", "admin", "member"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "waiting_on_user", "resolved", "closed"]);
export const ticketCategoryEnum = pgEnum("ticket_category", ["account", "payments", "contract", "safety", "technical", "other"]);
export const disputeStatusEnum = pgEnum("dispute_status", ["open", "under_review", "resolved_release", "resolved_refund", "withdrawn"]);
export const adminRoleEnum = pgEnum("admin_role", ["superadmin", "support", "moderator", "finance"]);

export const jobScreeningQuestions = pgTable(
  "job_screening_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    prompt: text("prompt").notNull(),
    required: boolean("required").notNull().default(true),
  },
  (t) => [uniqueIndex("job_screening_questions_seq_uq").on(t.jobId, t.seq)],
);

export const proposalAnswers = pgTable(
  "proposal_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => jobScreeningQuestions.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(), // snapshot of the question as answered
    answer: text("answer").notNull(),
  },
  (t) => [uniqueIndex("proposal_answers_uq").on(t.proposalId, t.questionId)],
);

export const jobInvitations = pgTable(
  "job_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => users.id),
    freelancerId: uuid("freelancer_id").notNull().references(() => users.id),
    message: text("message").notNull(),
    status: invitationStatusEnum("status").notNull().default("sent"),
    expiresAt: ts("expires_at").notNull(),
    respondedAt: ts("responded_at"),
    declineReason: text("decline_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("job_invitations_one_open_uq").on(t.jobId, t.freelancerId).where(sql`${t.status} = 'sent'`),
    index("job_invitations_freelancer_idx").on(t.freelancerId, t.status),
  ],
);

/** Private file metadata. Bytes live in the storage adapter under storage_key; access is checked per entity. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploaderId: uuid("uploader_id").notNull().references(() => users.id),
    entityType: attachmentEntityEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_entity_idx").on(t.entityType, t.entityId), check("attachments_size_positive", sql`${t.sizeBytes} > 0`)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey), index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // messages | proposals | contracts | payments | marketing-free product updates
    email: boolean("email").notNull().default(true),
    inApp: boolean("in_app").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category] })],
);

export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: uuid("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), check("user_blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`)],
);

export const abuseReports = pgTable(
  "abuse_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").notNull().references(() => users.id),
    targetType: reportTargetEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: reportReasonEnum("reason").notNull(),
    details: text("details"),
    status: reportStatusEnum("status").notNull().default("open"),
    resolutionNote: text("resolution_note"),
    handledBy: uuid("handled_by").references(() => users.id),
    handledAt: ts("handled_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("abuse_reports_status_idx").on(t.status, t.createdAt),
    uniqueIndex("abuse_reports_one_open_uq").on(t.reporterId, t.targetType, t.targetId).where(sql`${t.status} in ('open', 'reviewing')`),
  ],
);

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => users.id),
    freelancerId: uuid("freelancer_id").notNull().references(() => users.id),
    startsAt: ts("starts_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    agenda: text("agenda"),
    status: interviewStatusEnum("status").notNull().default("proposed"),
    roomName: text("room_name").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("interviews_client_idx").on(t.clientId, t.startsAt),
    index("interviews_freelancer_idx").on(t.freelancerId, t.startsAt),
    check("interviews_duration", sql`${t.durationMinutes} between 15 and 180`),
  ],
);

export const interviewEvents = pgTable("interview_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id").notNull().references(() => interviews.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

// ---------- hourly ----------
export const timesheets = pgTable(
  "timesheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(), // ISO date (Monday, UTC)
    minutes: integer("minutes").notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: timesheetStatusEnum("status").notNull().default("submitted"),
    disputeReason: text("dispute_reason"),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    approvedAt: ts("approved_at"),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("timesheets_contract_week_uq").on(t.contractId, t.weekStart), check("timesheets_minutes", sql`${t.minutes} > 0`)],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    freelancerId: uuid("freelancer_id").notNull().references(() => users.id),
    source: timeSourceEnum("source").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
    minutes: integer("minutes"),
    memo: text("memo").notNull().default(""),
    timesheetId: uuid("timesheet_id").references(() => timesheets.id),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("time_entries_contract_idx").on(t.contractId, t.startedAt),
    // At most one running timer per freelancer.
    uniqueIndex("time_entries_one_running_uq").on(t.freelancerId).where(sql`${t.endedAt} is null and ${t.deletedAt} is null`),
    check("time_entries_minutes", sql`${t.minutes} is null or (${t.minutes} > 0 and ${t.minutes} <= 1440)`),
  ],
);

export const timeEntryEvents = pgTable("time_entry_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  timeEntryId: uuid("time_entry_id").notNull().references(() => timeEntries.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id),
  kind: text("kind").notNull(), // created | edited | deleted | submitted
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const timesheetEvents = pgTable("timesheet_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  timesheetId: uuid("timesheet_id").notNull().references(() => timesheets.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id),
  actorKind: text("actor_kind").notNull().default("user"),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

// ---------- services catalog ----------
export const serviceListings = pgTable(
  "service_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freelancerId: uuid("freelancer_id").notNull().references(() => users.id),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    currency: text("currency").notNull(),
    maxConcurrentOrders: integer("max_concurrent_orders").notNull().default(3),
    status: serviceStatusEnum("status").notNull().default("draft"),
    moderationNote: text("moderation_note"),
    publishedAt: ts("published_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(description, '')), 'B')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("service_listings_status_idx").on(t.status),
    index("service_listings_freelancer_idx").on(t.freelancerId),
    index("service_listings_tsv_idx").using("gin", t.searchTsv),
    check("service_listings_concurrency", sql`${t.maxConcurrentOrders} between 1 and 50`),
  ],
);

export const serviceTiers = pgTable(
  "service_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => serviceListings.id, { onDelete: "cascade" }),
    tier: serviceTierEnum("tier").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    priceMinor: money("price_minor").notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    revisions: integer("revisions").notNull(),
  },
  (t) => [
    uniqueIndex("service_tiers_uq").on(t.listingId, t.tier),
    check("service_tiers_price", sql`${t.priceMinor} > 0`),
    check("service_tiers_days", sql`${t.deliveryDays} between 1 and 90`),
    check("service_tiers_revisions", sql`${t.revisions} between 0 and 10`),
  ],
);

export const serviceAddons = pgTable(
  "service_addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => serviceListings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceMinor: money("price_minor").notNull(),
    extraDays: integer("extra_days").notNull().default(0),
  },
  (t) => [check("service_addons_price", sql`${t.priceMinor} > 0`)],
);

export const serviceRequirements = pgTable(
  "service_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => serviceListings.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    prompt: text("prompt").notNull(),
    required: boolean("required").notNull().default(true),
  },
  (t) => [uniqueIndex("service_requirements_seq_uq").on(t.listingId, t.seq)],
);

export const serviceListingEvents = pgTable("service_listing_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  listingId: uuid("listing_id").notNull().references(() => serviceListings.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

export const serviceOrders = pgTable(
  "service_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => serviceListings.id),
    buyerId: uuid("buyer_id").notNull().references(() => users.id),
    sellerId: uuid("seller_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    tier: serviceTierEnum("tier").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(), // tier, add-ons, requirements, fee rule
    currency: text("currency").notNull(),
    totalMinor: money("total_minor").notNull(),
    feeRuleSnapshot: jsonb("fee_rule_snapshot").$type<Record<string, unknown>>().notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    revisionsAllowed: integer("revisions_allowed").notNull(),
    revisionsUsed: integer("revisions_used").notNull().default(0),
    status: orderStatusEnum("status").notNull().default("pending_payment"),
    paidAt: ts("paid_at"),
    dueAt: ts("due_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("service_orders_buyer_idx").on(t.buyerId, t.status),
    index("service_orders_seller_idx").on(t.sellerId, t.status),
    check("service_orders_total", sql`${t.totalMinor} > 0`),
  ],
);

export const orderRequirementAnswers = pgTable(
  "order_requirement_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => serviceOrders.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    answer: text("answer").notNull(),
    seq: integer("seq").notNull(),
  },
  (t) => [uniqueIndex("order_requirement_answers_uq").on(t.orderId, t.seq)],
);

export const orderDeliveries = pgTable(
  "order_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => serviceOrders.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    note: text("note").notNull(),
    revisionNote: text("revision_note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("order_deliveries_version_uq").on(t.orderId, t.version)],
);

export const orderEvents = pgTable("order_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => serviceOrders.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id),
  actorKind: text("actor_kind").notNull().default("user"),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

// ---------- reviews ----------
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").references(() => contracts.id),
    orderId: uuid("order_id").references(() => serviceOrders.id),
    reviewerId: uuid("reviewer_id").notNull().references(() => users.id),
    revieweeId: uuid("reviewee_id").notNull().references(() => users.id),
    reviewerRole: text("reviewer_role").notNull(), // client | freelancer
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    visibleAt: ts("visible_at"), // null until both sides submit or the review window closes
    hiddenByModeration: boolean("hidden_by_moderation").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reviews_contract_reviewer_uq").on(t.contractId, t.reviewerId).where(sql`${t.contractId} is not null`),
    uniqueIndex("reviews_order_reviewer_uq").on(t.orderId, t.reviewerId).where(sql`${t.orderId} is not null`),
    index("reviews_reviewee_idx").on(t.revieweeId, t.visibleAt),
    check("reviews_rating", sql`${t.rating} between 1 and 5`),
    check("reviews_one_target", sql`num_nonnulls(${t.contractId}, ${t.orderId}) = 1`),
    check("reviews_not_self", sql`${t.reviewerId} <> ${t.revieweeId}`),
  ],
);

// ---------- agencies ----------
export const agencies = pgTable("agencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  isPublished: boolean("is_published").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agencyMembers = pgTable(
  "agency_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: agencyRoleEnum("role").notNull(),
    joinedAt: createdAt(),
    removedAt: ts("removed_at"),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("agency_members_active_uq").on(t.agencyId, t.userId).where(sql`${t.removedAt} is null`),
    index("agency_members_user_idx").on(t.userId),
  ],
);

export const agencyInvitations = pgTable(
  "agency_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    inviteeId: uuid("invitee_id").notNull().references(() => users.id),
    role: agencyRoleEnum("role").notNull(),
    invitedBy: uuid("invited_by").notNull().references(() => users.id),
    status: invitationStatusEnum("status").notNull().default("sent"),
    expiresAt: ts("expires_at").notNull(),
    respondedAt: ts("responded_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agency_invitations_open_uq").on(t.agencyId, t.inviteeId).where(sql`${t.status} = 'sent'`)],
);

// ---------- support, disputes, admin ----------
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    subject: text("subject").notNull(),
    category: ticketCategoryEnum("category").notNull(),
    status: ticketStatusEnum("status").notNull().default("open"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("support_tickets_user_idx").on(t.userId), index("support_tickets_status_idx").on(t.status, t.updatedAt)],
);

export const supportMessages = pgTable("support_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  isStaff: boolean("is_staff").notNull().default(false),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id),
    contractId: uuid("contract_id").notNull().references(() => contracts.id),
    openedBy: uuid("opened_by").notNull().references(() => users.id),
    reason: text("reason").notNull(),
    priorMilestoneStatus: text("prior_milestone_status").notNull(),
    status: disputeStatusEnum("status").notNull().default("open"),
    resolutionNote: text("resolution_note"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("disputes_one_open_per_milestone_uq").on(t.milestoneId).where(sql`${t.status} in ('open', 'under_review')`),
    index("disputes_status_idx").on(t.status),
  ],
);

export const disputeEvents = pgTable("dispute_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  disputeId: uuid("dispute_id").notNull().references(() => disputes.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

export const adminRoles = pgTable(
  "admin_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: adminRoleEnum("role").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/** Fixed-window counters for the DB-backed rate limiter. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});
