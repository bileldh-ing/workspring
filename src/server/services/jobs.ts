import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { categories, jobEvents, jobScreeningQuestions, jobSkills, jobs, proposals, skills, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { toMinor } from "@/domain/money";
import { type Actor, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import { assertTransition, jobMachine } from "@/domain/state-machines";
import { jobSchema, parseOrThrow, type JobSearch } from "@/domain/validation";
import { audit } from "./audit";
import { categoryBySlug, skillIdsBySlugs, slugify } from "./taxonomy";

export const JOB_PAGE_SIZE = 10;
type JobStatus = "draft" | "open" | "paused" | "closed";

async function normalizeJobInput(db: Executor, raw: unknown) {
  const input = parseOrThrow(jobSchema, raw);
  const budgetMaxMinor = toMinor(input.budgetMax, input.currency);
  const budgetMinMinor = input.budgetMin ? toMinor(input.budgetMin, input.currency) : null;
  if (budgetMinMinor !== null && budgetMinMinor > budgetMaxMinor) {
    throw new AppError("VALIDATION", "Minimum budget can't exceed the maximum", { budgetMin: "Must be ≤ maximum" });
  }
  const category = await categoryBySlug(db, input.categorySlug);
  const skillIds = await skillIdsBySlugs(db, input.skills);
  return {
    values: {
      title: input.title,
      description: input.description,
      categoryId: category.id,
      contractType: input.contractType,
      currency: input.currency,
      budgetMinMinor,
      budgetMaxMinor,
      scope: input.scope,
      experienceLevel: input.experienceLevel,
      locationNote: input.locationNote || null,
    },
    skillIds,
    questions: input.screeningQuestions ?? [],
  };
}

export async function screeningQuestionsFor(db: Executor, jobId: string) {
  return db.select().from(jobScreeningQuestions).where(eq(jobScreeningQuestions.jobId, jobId)).orderBy(jobScreeningQuestions.seq);
}

export async function createJob(db: DB, actor: Actor, raw: unknown) {
  requireCapability(actor, "client");
  const { values, skillIds, questions } = await normalizeJobInput(db, raw);
  return db.transaction(async (tx) => {
    const slug = `${slugify(values.title) || "job"}-${crypto.randomUUID().slice(0, 8)}`;
    const [job] = await tx.insert(jobs).values({ ...values, clientId: actor.userId, slug, status: "draft" }).returning();
    await tx.insert(jobSkills).values(skillIds.map((skillId) => ({ jobId: job.id, skillId })));
    await tx.insert(jobEvents).values({ jobId: job.id, actorId: actor.userId, fromStatus: null, toStatus: "draft" });
    if (questions.length) await tx.insert(jobScreeningQuestions).values(questions.map((prompt, i) => ({ jobId: job.id, seq: i + 1, prompt })));
    return job;
  });
}

async function loadOwnedJob(db: Executor, actor: Actor, jobId: string, lock = false) {
  const q = db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.clientId, actor.userId)));
  const [job] = lock ? await q.for("update") : await q;
  // Not-owned and missing look identical (no enumeration of other clients' drafts).
  if (!job) throw new AppError("NOT_FOUND", "Job not found");
  return job;
}

export async function updateJob(db: DB, actor: Actor, jobId: string, raw: unknown) {
  requireCapability(actor, "client");
  const { values, skillIds, questions } = await normalizeJobInput(db, raw);
  return db.transaction(async (tx) => {
    const job = await loadOwnedJob(tx, actor, jobId, true);
    if (job.status === "closed") throw new AppError("INVALID_TRANSITION", "Closed jobs can't be edited");
    const existing = (await tx.select().from(jobScreeningQuestions).where(eq(jobScreeningQuestions.jobId, jobId)).orderBy(jobScreeningQuestions.seq)).map((q) => q.prompt);
    if (JSON.stringify(existing) !== JSON.stringify(questions)) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(proposals).where(eq(proposals.jobId, jobId));
      if (Number(n) > 0) throw new AppError("CONFLICT", "Screening questions can't change after proposals have arrived", { screeningQuestions: "Locked: proposals already answered them" });
      await tx.delete(jobScreeningQuestions).where(eq(jobScreeningQuestions.jobId, jobId));
      if (questions.length) await tx.insert(jobScreeningQuestions).values(questions.map((prompt, i) => ({ jobId, seq: i + 1, prompt })));
    }
    await tx.update(jobs).set({ ...values, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    await tx.delete(jobSkills).where(eq(jobSkills.jobId, jobId));
    await tx.insert(jobSkills).values(skillIds.map((skillId) => ({ jobId, skillId })));
    await audit(tx, { actorId: actor.userId, action: "job.edited", entityType: "job", entityId: jobId });
  });
}

export async function transitionJob(db: DB, actor: Actor, jobId: string, to: JobStatus) {
  requireCapability(actor, "client");
  if (to === "open") requireVerifiedEmail(actor);
  return db.transaction(async (tx) => {
    const job = await loadOwnedJob(tx, actor, jobId, true);
    assertTransition(jobMachine, job.status, to, "job");
    await tx
      .update(jobs)
      .set({
        status: to,
        publishedAt: to === "open" ? (job.publishedAt ?? new Date()) : job.publishedAt,
        closedAt: to === "closed" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    await tx.insert(jobEvents).values({ jobId, actorId: actor.userId, fromStatus: job.status, toStatus: to });
    return { from: job.status, to };
  });
}

export async function getOwnedJob(db: Executor, actor: Actor, jobId: string) {
  requireCapability(actor, "client");
  const job = await loadOwnedJob(db, actor, jobId);
  const sk = await jobSkillsFor(db, [job.id]);
  const [cat] = job.categoryId ? await db.select().from(categories).where(eq(categories.id, job.categoryId)) : [];
  const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id)).orderBy(desc(jobEvents.createdAt));
  const questions = await screeningQuestionsFor(db, job.id);
  return { ...job, skills: sk.filter((s) => s.jobId === job.id), categorySlug: cat?.slug ?? "", events, questions };
}

export async function listMyJobs(db: Executor, actor: Actor) {
  requireCapability(actor, "client");
  return db.execute<{ id: string; title: string; status: JobStatus; created_at: Date; proposal_count: number; slug: string }>(sql`
    select j.id, j.title, j.status, j.slug, j.created_at,
      (select count(*)::int from proposals p where p.job_id = j.id and p.status <> 'withdrawn') as proposal_count
    from jobs j where j.client_id = ${actor.userId} order by j.created_at desc`);
}

async function jobSkillsFor(db: Executor, jobIds: string[]) {
  if (jobIds.length === 0) return [];
  return db
    .select({ jobId: jobSkills.jobId, slug: skills.slug, name: skills.name })
    .from(jobSkills)
    .innerJoin(skills, eq(skills.id, jobSkills.skillId))
    .where(inArray(jobSkills.jobId, jobIds));
}

/** Public job detail. Drafts are never public; paused/closed jobs render with a not-accepting banner. */
export async function getPublicJob(db: Executor, slug: string) {
  const [row] = await db
    .select({ job: jobs, clientName: users.displayName, categoryName: categories.name })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.clientId))
    .leftJoin(categories, eq(categories.id, jobs.categoryId))
    .where(and(eq(jobs.slug, slug), inArray(jobs.status, ["open", "paused", "closed"])))
    .limit(1);
  if (!row) return null;
  const sk = await jobSkillsFor(db, [row.job.id]);
  const [{ n }] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from proposals where job_id = ${row.job.id} and status <> 'withdrawn'`,
  );
  const questions = await screeningQuestionsFor(db, row.job.id);
  return { ...row.job, clientName: row.clientName, categoryName: row.categoryName, skills: sk, proposalCount: Number(n), questions };
}

/** Postgres full-text search over OPEN jobs with server-side filters, sorting and pagination. */
export async function searchJobs(db: Executor, p: JobSearch) {
  const where: SQL[] = [sql`j.status = 'open'`];
  const q = p.q.trim();
  if (q) where.push(sql`j.search_tsv @@ websearch_to_tsquery('english', ${q})`);
  if (p.category) where.push(sql`c.slug = ${p.category}`);
  if (p.skill) where.push(sql`exists (select 1 from job_skills js join skills s on s.id = js.skill_id where js.job_id = j.id and s.slug = ${p.skill})`);
  if (p.type) where.push(sql`j.contract_type = ${p.type}`);
  if (p.level) where.push(sql`j.experience_level = ${p.level}`);
  // minBudget is in major units of 2-decimal currencies; TND jobs (3 decimals) are compared on their own scale.
  if (p.minBudget !== undefined)
    where.push(sql`j.budget_max_minor >= ${p.minBudget} * (case when j.currency = 'TND' then 1000 else 100 end)`);
  const rank = sql`ts_rank(j.search_tsv, websearch_to_tsquery('english', ${q}))`;
  const order =
    p.sort === "newest" || (!q && p.sort === "relevance") // relevance needs a query; never emit `order by 0`
      ? sql`j.published_at desc`
      : p.sort === "budget_desc"
        ? sql`j.budget_max_minor desc nulls last, j.published_at desc`
        : sql`${rank} desc, j.published_at desc`;
  const offset = (p.page - 1) * JOB_PAGE_SIZE;
  const rows = await db.execute<{
    id: string; slug: string; title: string; description: string; contract_type: "fixed" | "hourly";
    budget_min_minor: number | null; budget_max_minor: number | null; currency: string; scope: string;
    experience_level: string; published_at: Date; category_name: string | null; is_demo: boolean; proposal_count: number; total: number;
  }>(sql`
    select j.id, j.slug, j.title, left(j.description, 320) as description, j.contract_type, j.budget_min_minor, j.budget_max_minor,
           j.currency, j.scope, j.experience_level, j.published_at, c.name as category_name, j.is_demo,
           (select count(*)::int from proposals p where p.job_id = j.id and p.status <> 'withdrawn') as proposal_count,
           count(*) over()::int as total
    from jobs j left join categories c on c.id = j.category_id
    where ${sql.join(where, sql` and `)}
    order by ${order}
    limit ${JOB_PAGE_SIZE} offset ${offset}`);
  const sk = await jobSkillsFor(db, rows.map((r) => r.id));
  return {
    total: rows[0]?.total ?? 0,
    page: p.page,
    pageSize: JOB_PAGE_SIZE,
    results: rows.map((r) => ({
      ...r,
      budget_min_minor: r.budget_min_minor === null ? null : Number(r.budget_min_minor),
      budget_max_minor: r.budget_max_minor === null ? null : Number(r.budget_max_minor),
      skills: sk.filter((s) => s.jobId === r.id),
    })),
  };
}
