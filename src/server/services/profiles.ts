import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { categories, freelancerProfiles, profileSkills, skills, users } from "@/db/schema";
import { AppError } from "@/domain/errors";
import { isCurrency, toMinor } from "@/domain/money";
import { type Actor, requireCapability, requireVerifiedEmail } from "@/domain/permissions";
import { freelancerProfileSchema, parseOrThrow, type TalentSearch } from "@/domain/validation";
import { audit } from "./audit";
import { categoryBySlug, skillIdsBySlugs, slugify } from "./taxonomy";

export const TALENT_PAGE_SIZE = 10;

export async function getMyProfile(db: Executor, actor: Actor) {
  const [p] = await db.select().from(freelancerProfiles).where(eq(freelancerProfiles.userId, actor.userId)).limit(1);
  if (!p) return null;
  const sk = await db
    .select({ slug: skills.slug, name: skills.name })
    .from(profileSkills)
    .innerJoin(skills, eq(skills.id, profileSkills.skillId))
    .where(eq(profileSkills.userId, actor.userId));
  const [cat] = p.categoryId ? await db.select().from(categories).where(eq(categories.id, p.categoryId)) : [];
  return { ...p, skills: sk, categorySlug: cat?.slug ?? "" };
}

async function uniqueSlug(db: Executor, base: string) {
  const root = slugify(base) || "freelancer";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 6)}`;
    const [hit] = await db.select({ s: freelancerProfiles.slug }).from(freelancerProfiles).where(eq(freelancerProfiles.slug, candidate));
    if (!hit) return candidate;
  }
  throw new Error("could not allocate slug");
}

/** Creates or updates the caller's freelancer profile. New profiles start as drafts. */
export async function saveProfile(db: DB, actor: Actor, raw: unknown) {
  requireCapability(actor, "freelancer");
  const input = parseOrThrow(freelancerProfileSchema, raw);
  if (!isCurrency(input.currency)) throw new AppError("VALIDATION", "Unsupported currency");
  const hourlyRateMinor = toMinor(input.hourlyRate, input.currency);
  const category = await categoryBySlug(db, input.categorySlug);
  const skillIds = await skillIdsBySlugs(db, input.skills);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(freelancerProfiles).where(eq(freelancerProfiles.userId, actor.userId)).for("update");
    const values = {
      title: input.title,
      overview: input.overview,
      hourlyRateMinor,
      currency: input.currency,
      timezone: input.timezone,
      availability: input.availability,
      experienceLevel: input.experienceLevel,
      categoryId: category.id,
      updatedAt: new Date(),
    };
    if (existing) {
      await tx.update(freelancerProfiles).set(values).where(eq(freelancerProfiles.userId, actor.userId));
    } else {
      await tx.insert(freelancerProfiles).values({ userId: actor.userId, slug: await uniqueSlug(tx, actor.displayName), ...values });
    }
    await tx.delete(profileSkills).where(eq(profileSkills.userId, actor.userId));
    await tx.insert(profileSkills).values(skillIds.map((skillId) => ({ userId: actor.userId, skillId })));
    await audit(tx, { actorId: actor.userId, action: existing ? "profile.updated" : "profile.created", entityType: "freelancer_profile", entityId: actor.userId });
    return { created: !existing };
  });
}

export async function setProfileVisibility(db: DB, actor: Actor, publish: boolean) {
  requireCapability(actor, "freelancer");
  const profile = await getMyProfile(db, actor);
  if (!profile) throw new AppError("NOT_FOUND", "Create your profile first");
  if (publish) {
    requireVerifiedEmail(actor);
    if (profile.skills.length === 0 || !profile.hourlyRateMinor) throw new AppError("VALIDATION", "Complete your profile before publishing");
  }
  await db
    .update(freelancerProfiles)
    .set({ status: publish ? "published" : "hidden", publishedAt: publish ? (profile.publishedAt ?? new Date()) : profile.publishedAt, updatedAt: new Date() })
    .where(eq(freelancerProfiles.userId, actor.userId));
  await audit(db, { actorId: actor.userId, action: publish ? "profile.published" : "profile.hidden", entityType: "freelancer_profile", entityId: actor.userId });
}

/** Public SSR profile: published only, and never exposes email or private fields. */
export async function getPublicProfile(db: Executor, slug: string) {
  const [row] = await db
    .select({
      userId: freelancerProfiles.userId,
      slug: freelancerProfiles.slug,
      displayName: users.displayName,
      title: freelancerProfiles.title,
      overview: freelancerProfiles.overview,
      hourlyRateMinor: freelancerProfiles.hourlyRateMinor,
      currency: freelancerProfiles.currency,
      timezone: freelancerProfiles.timezone,
      availability: freelancerProfiles.availability,
      experienceLevel: freelancerProfiles.experienceLevel,
      publishedAt: freelancerProfiles.publishedAt,
      isDemo: users.isDemo,
      categoryName: categories.name,
    })
    .from(freelancerProfiles)
    .innerJoin(users, eq(users.id, freelancerProfiles.userId))
    .leftJoin(categories, eq(categories.id, freelancerProfiles.categoryId))
    .where(and(eq(freelancerProfiles.slug, slug), eq(freelancerProfiles.status, "published"), eq(users.status, "active")))
    .limit(1);
  if (!row) return null;
  const sk = await db
    .select({ slug: skills.slug, name: skills.name })
    .from(profileSkills)
    .innerJoin(skills, eq(skills.id, profileSkills.skillId))
    .where(eq(profileSkills.userId, row.userId))
    .orderBy(asc(skills.name));
  // Real platform evidence only: count of contracts completed on WorkSpring.
  const [{ completed }] = await db.execute<{ completed: number }>(
    sql`select count(*)::int as completed from contracts where freelancer_id = ${row.userId} and status = 'completed'`,
  );
  return { ...row, skills: sk, completedContracts: Number(completed) };
}

export async function searchTalent(db: Executor, p: TalentSearch) {
  const where: SQL[] = [sql`fp.status = 'published'`, sql`u.status = 'active'`];
  const q = p.q.trim();
  if (q) where.push(sql`fp.search_tsv @@ websearch_to_tsquery('english', ${q})`);
  if (p.skill) where.push(sql`exists (select 1 from profile_skills ps join skills s on s.id = ps.skill_id where ps.user_id = fp.user_id and s.slug = ${p.skill})`);
  if (p.level) where.push(sql`fp.experience_level = ${p.level}`);
  if (p.maxRate !== undefined) where.push(sql`fp.hourly_rate_minor <= ${p.maxRate * 100} and fp.currency in ('USD','EUR')`);
  const whereSql = sql.join(where, sql` and `);
  const rank = q ? sql`ts_rank(fp.search_tsv, websearch_to_tsquery('english', ${q}))` : sql`0`;
  const offset = (p.page - 1) * TALENT_PAGE_SIZE;
  const rows = await db.execute<{
    user_id: string; slug: string; display_name: string; title: string; overview: string;
    hourly_rate_minor: number | null; currency: string; availability: string; experience_level: string; is_demo: boolean; total: number;
  }>(sql`
    select fp.user_id, fp.slug, u.display_name, fp.title, left(fp.overview, 280) as overview, fp.hourly_rate_minor, fp.currency,
           fp.availability, fp.experience_level, u.is_demo, count(*) over()::int as total
    from freelancer_profiles fp join users u on u.id = fp.user_id
    where ${whereSql}
    order by ${rank} desc, fp.published_at desc nulls last
    limit ${TALENT_PAGE_SIZE} offset ${offset}`);
  const ids = rows.map((r) => r.user_id);
  const sk = ids.length
    ? await db
        .select({ userId: profileSkills.userId, name: skills.name, slug: skills.slug })
        .from(profileSkills)
        .innerJoin(skills, eq(skills.id, profileSkills.skillId))
        .where(inArray(profileSkills.userId, ids))
    : [];
  return {
    total: rows[0]?.total ?? 0,
    page: p.page,
    pageSize: TALENT_PAGE_SIZE,
    results: rows.map((r) => ({ ...r, hourly_rate_minor: r.hourly_rate_minor === null ? null : Number(r.hourly_rate_minor), skills: sk.filter((s) => s.userId === r.user_id) })),
  };
}
