import { eq, sql } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { categories, skills, users } from "@/db/schema";
import type { Actor } from "@/domain/permissions";
import { getActorByUserId, register } from "@/server/services/auth";

let holder: ReturnType<typeof createDb> | null = null;

export function testDb(): DB {
  holder ??= createDb(process.env.DATABASE_URL!, 12);
  return holder.db;
}

export async function closeTestDb() {
  await holder?.sql.end({ timeout: 5 });
  holder = null;
}

/** Empties every table except migrations and fee rules (TRUNCATE bypasses the append-only row triggers). */
export async function resetDb(db: DB) {
  await db.execute(sql`
    do $$ declare r record; begin
      for r in select tablename from pg_tables where schemaname = 'public' and tablename not in ('platform_fee_rules') loop
        execute 'truncate table ' || quote_ident(r.tablename) || ' restart identity cascade';
      end loop;
    end $$;`);
  const [dev] = await db.insert(categories).values({ slug: "web-dev", name: "Web Development" }).returning();
  await db.insert(skills).values([
    { slug: "typescript", name: "TypeScript", categoryId: dev.id },
    { slug: "react", name: "React", categoryId: dev.id },
    { slug: "postgresql", name: "PostgreSQL", categoryId: dev.id },
  ]);
}

let n = 0;
export async function makeUser(db: DB, intent: "hire" | "work", opts: { verified?: boolean; name?: string } = {}): Promise<Actor> {
  n++;
  const { userId } = await register(db, {
    email: `user${n}-${Date.now()}@example.test`,
    password: "correct horse battery staple",
    displayName: opts.name ?? `${intent === "hire" ? "Client" : "Freelancer"} ${n}`,
    intent,
  });
  if (opts.verified !== false) await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  return (await getActorByUserId(db, userId))!;
}

export const LONG = (s: string) => `${s} `.repeat(Math.ceil(60 / (s.length + 1))).trim();

export const jobInput = (over: Record<string, unknown> = {}) => ({
  title: "Build a TypeScript invoicing dashboard",
  description: LONG("We need a React and PostgreSQL dashboard for invoices with filters and exports."),
  categorySlug: "web-dev",
  skills: ["typescript", "react"],
  contractType: "fixed",
  currency: "USD",
  budgetMin: "500",
  budgetMax: "1500",
  scope: "medium",
  experienceLevel: "intermediate",
  ...over,
});

export const profileInput = (over: Record<string, unknown> = {}) => ({
  title: "Full-stack TypeScript engineer",
  overview: LONG("I build reliable web apps with TypeScript, React and PostgreSQL for small teams."),
  hourlyRate: "45",
  currency: "USD",
  timezone: "Africa/Tunis",
  availability: "available",
  experienceLevel: "intermediate",
  categorySlug: "web-dev",
  skills: ["typescript", "postgresql"],
  ...over,
});
