/**
 * SYNTHETIC DEMO SEED. Every user created here is flagged is_demo=true, has a "[Demo]" display-name prefix and a
 * @demo.workspring.test address. No real people, companies, reviews, verifications or transactions are created.
 * Idempotent: re-running skips existing demo users. Usage: pnpm db:seed
 */
import { eq, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { categories, skills, users } from "../src/db/schema";
import { getActorByUserId, register } from "../src/server/services/auth";
import { createJob, transitionJob } from "../src/server/services/jobs";
import { saveProfile, setProfileVisibility } from "../src/server/services/profiles";
import { loadEnv } from "./env";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Refusing to seed demo data in production");
const { db, sql: client } = createDb(url, 2);

export const DEMO_PASSWORD = "demo-password-2026";

const TAXONOMY: Record<string, { name: string; skills: string[] }> = {
  "web-mobile-dev": { name: "Web & Mobile Development", skills: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "Flutter", "Python", "Django"] },
  "design-creative": { name: "Design & Creative", skills: ["UI Design", "Brand Identity", "Figma", "Illustration", "Motion Graphics"] },
  "writing-translation": { name: "Writing & Translation", skills: ["Technical Writing", "Copywriting", "French Translation", "Arabic Translation"] },
  "data-ai": { name: "Data & AI", skills: ["Data Analysis", "Machine Learning", "Computer Vision", "SQL", "Power BI"] },
  "engineering-hardware": { name: "Engineering & Hardware", skills: ["Embedded C", "IoT", "ROS", "3D CAD"] },
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function ensureTaxonomy() {
  for (const [catSlug, def] of Object.entries(TAXONOMY)) {
    await db.insert(categories).values({ slug: catSlug, name: def.name }).onConflictDoNothing();
    const [cat] = await db.select().from(categories).where(eq(categories.slug, catSlug));
    for (const s of def.skills) await db.insert(skills).values({ slug: slug(s), name: s, categoryId: cat.id }).onConflictDoNothing();
  }
}

async function demoUser(key: string, name: string, intent: "hire" | "work") {
  const email = `${key}@demo.workspring.test`;
  const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  let id = existing?.id;
  if (!id) id = (await register(db, { email, password: DEMO_PASSWORD, displayName: `[Demo] ${name}`, intent })).userId;
  await db.update(users).set({ isDemo: true, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, id));
  return { actor: (await getActorByUserId(db, id))!, created: !existing, email };
}

const FREELANCERS = [
  { key: "amira", name: "Amira B.", title: "Full-stack TypeScript & PostgreSQL engineer", cat: "web-mobile-dev", skills: ["typescript", "react", "next-js", "postgresql"], rate: "45", level: "expert",
    overview: "Synthetic demo profile. I design and build web applications end to end: schema design in PostgreSQL, typed APIs in Node.js and accessible React front ends. I like clear milestones and written acceptance criteria." },
  { key: "youssef", name: "Youssef K.", title: "Flutter mobile developer", cat: "web-mobile-dev", skills: ["flutter", "node-js"], rate: "30", level: "intermediate",
    overview: "Synthetic demo profile. Cross-platform mobile apps with Flutter, offline-first data sync and clean state management. Comfortable shipping to both app stores and writing handover docs." },
  { key: "lea", name: "Léa M.", title: "Brand identity and UI designer", cat: "design-creative", skills: ["brand-identity", "ui-design", "figma"], rate: "55", level: "expert",
    overview: "Synthetic demo profile. Logos, visual identity systems and product UI in Figma, with accessible colour palettes and documented components that developers can implement directly." },
  { key: "sami", name: "Sami T.", title: "Computer vision & ML engineer", cat: "data-ai", skills: ["computer-vision", "machine-learning", "python"], rate: "50", level: "intermediate",
    overview: "Synthetic demo profile. Object detection, image classification and model evaluation with Python. I document datasets, metrics and limitations honestly so results can be reproduced." },
  { key: "nour", name: "Nour H.", title: "Technical writer (EN/FR/AR)", cat: "writing-translation", skills: ["technical-writing", "french-translation", "arabic-translation"], rate: "25", level: "intermediate",
    overview: "Synthetic demo profile. API documentation, user guides and localisation between English, French and Arabic, with consistent terminology glossaries for each project." },
];

const JOBS = [
  { title: "Build an invoicing dashboard with React and PostgreSQL", cat: "web-mobile-dev", skills: ["react", "postgresql", "typescript"], type: "fixed", min: "800", max: "1500", scope: "medium", level: "intermediate",
    desc: "Synthetic demo job. We need a web dashboard to list, filter and export invoices. Deliverables: React UI with filters and CSV export, a PostgreSQL schema with migrations, and automated tests. Success means a reviewed pull request and a short handover document." },
  { title: "Flutter app for a neighbourhood library", cat: "web-mobile-dev", skills: ["flutter"], type: "fixed", min: "1200", max: "2500", scope: "medium", level: "intermediate",
    desc: "Synthetic demo job. A small mobile app where members browse the catalogue, reserve books and get due-date reminders. Deliverables: Flutter app for Android and iOS, simple admin screen, and store submission support." },
  { title: "Logo and brand guidelines for a cycling cooperative", cat: "design-creative", skills: ["brand-identity", "illustration"], type: "fixed", min: "300", max: "700", scope: "small", level: "expert",
    desc: "Synthetic demo job. Looking for a primary logo, a secondary mark, colour palette and a 10-page brand guideline PDF. Please describe your process and how many concepts you usually present." },
  { title: "Translate developer documentation from English to French", cat: "writing-translation", skills: ["french-translation", "technical-writing"], type: "hourly", min: "15", max: "30", scope: "small", level: "intermediate",
    desc: "Synthetic demo job. About 20,000 words of API reference and tutorials need translating into French with a consistent glossary. Work is delivered as Markdown pull requests and reviewed weekly." },
  { title: "Defect detection model for a small production line", cat: "data-ai", skills: ["computer-vision", "machine-learning", "python"], type: "fixed", min: "2000", max: "4000", scope: "large", level: "expert",
    desc: "Synthetic demo job. We have roughly 5,000 labelled images of parts and need a model that flags visual defects, with an evaluation report (precision/recall per class) and a simple inference script." },
  { title: "Power BI sales report for a retail chain", cat: "data-ai", skills: ["power-bi", "sql"], type: "fixed", min: "400", max: "900", scope: "small", level: "entry",
    desc: "Synthetic demo job. Build a Power BI report on top of an existing SQL Server database: monthly sales by store and category, with a short guide on refreshing the dataset." },
  { title: "ROS 2 navigation tuning for a warehouse robot prototype", cat: "engineering-hardware", skills: ["ros", "embedded-c"], type: "hourly", min: "30", max: "60", scope: "medium", level: "expert",
    desc: "Synthetic demo job. Prototype differential-drive robot running ROS 2. We need help tuning the navigation stack, documenting parameters and writing a test procedure for repeatable runs." },
  { title: "Next.js marketing site with a headless CMS", cat: "web-mobile-dev", skills: ["next-js", "typescript"], type: "fixed", min: "600", max: "1200", scope: "small", level: "intermediate",
    desc: "Synthetic demo job. Five-page marketing site in Next.js with content editable by non-developers, good Lighthouse scores and accessible components. Hosting setup notes required." },
];

await ensureTaxonomy();
const client1 = await demoUser("client-olive", "Olive Studio (client)", "hire");
const client2 = await demoUser("client-atlas", "Atlas Robotics (client)", "hire");
for (const f of FREELANCERS) {
  const u = await demoUser(f.key, f.name, "work");
  if (u.created) {
    await saveProfile(db, u.actor, { title: f.title, overview: f.overview, hourlyRate: f.rate, currency: "USD", timezone: "Africa/Tunis", availability: "available", experienceLevel: f.level, categorySlug: f.cat, skills: f.skills });
    await setProfileVisibility(db, u.actor, true);
  }
}
if (client1.created) {
  for (const [i, j] of JOBS.entries()) {
    const owner = i % 3 === 2 ? client2.actor : client1.actor;
    const job = await createJob(db, owner, { title: j.title, description: j.desc, categorySlug: j.cat, skills: j.skills, contractType: j.type, currency: "USD", budgetMin: j.min, budgetMax: j.max, scope: j.scope, experienceLevel: j.level });
    await db.execute(sql`update jobs set is_demo = true where id = ${job.id}`);
    if (i < JOBS.length - 1) await transitionJob(db, owner, job.id, "open"); // last one stays a draft
  }
}
console.log("[seed] synthetic demo data ready. All demo accounts use password:", DEMO_PASSWORD);
console.log("  clients:     client-olive@demo.workspring.test, client-atlas@demo.workspring.test");
console.log("  freelancers:", FREELANCERS.map((f) => `${f.key}@demo.workspring.test`).join(", "));
await client.end();
