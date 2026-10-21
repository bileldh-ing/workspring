import { asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { categories, skills } from "@/db/schema";
import { AppError } from "@/domain/errors";

export function listCategories(db: Executor) {
  return db.select().from(categories).orderBy(asc(categories.name));
}

export function listSkills(db: Executor) {
  return db
    .select({ id: skills.id, slug: skills.slug, name: skills.name, categoryId: skills.categoryId })
    .from(skills)
    .orderBy(asc(skills.name));
}

export async function categoryBySlug(db: Executor, slug: string) {
  const [c] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  if (!c) throw new AppError("VALIDATION", "Unknown category", { categorySlug: "Choose a category from the list" });
  return c;
}

/** Resolves skill slugs against the normalized taxonomy; unknown slugs are a validation error (no free-form tags). */
export async function skillIdsBySlugs(db: Executor, slugs: string[]) {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return [];
  const rows = await db.select({ id: skills.id, slug: skills.slug }).from(skills).where(inArray(skills.slug, unique));
  if (rows.length !== unique.length) {
    throw new AppError("VALIDATION", "One or more skills are not in the taxonomy", { skills: "Pick skills from the list" });
  }
  return rows.map((r) => r.id);
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
}
