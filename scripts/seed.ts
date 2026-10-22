/**
 * SYNTHETIC DEMO SEED. Every user created here is flagged is_demo=true, has a "[Demo]" display-name prefix and a
 * @demo.workspring.test address. No real people, companies, reviews, verifications or transactions are created.
 * Idempotent: re-running skips existing demo users. Usage: pnpm db:seed
 */
import { eq, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { adminRoles, agencies, agencyInvitations, categories, milestones, serviceListings, skills, users } from "../src/db/schema";
import { createAgency, inviteMember, respondAgencyInvitation, updateAgency } from "../src/server/services/agencies";
import { createService, moderateService, ownerTransition } from "../src/server/services/catalog";
import { acceptOffer, approveMilestone, createOffer, deliverMilestone, fundMilestone } from "../src/server/services/contracts";
import { addManualEntry } from "../src/server/services/hourly";
import { placeOrder, submitRequirements } from "../src/server/services/orders";
import { simulateTestProviderOutcome } from "../src/server/services/payments";
import { submitProposal } from "../src/server/services/proposals";
import { submitReview } from "../src/server/services/reviews";
import { fileReport } from "../src/server/services/safety";
import { openTicket } from "../src/server/services/support";
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
// ---------- R2 synthetic demo data: staff, services, order, agency, completed contract with reviews, hourly contract
const STAFF = [
  { key: "admin", name: "Admin (superadmin)", role: "superadmin" },
  { key: "support", name: "Support agent", role: "support" },
  { key: "moderator", name: "Moderator", role: "moderator" },
  { key: "finance", name: "Finance", role: "finance" },
] as const;
const staff: Record<string, Awaited<ReturnType<typeof demoUser>>> = {};
for (const st of STAFF) {
  const u = await demoUser(st.key, st.name, "hire");
  await db.insert(adminRoles).values({ userId: u.actor.userId, role: st.role }).onConflictDoNothing();
  await db.execute(sql`insert into user_capabilities (user_id, capability) values (${u.actor.userId}, 'admin') on conflict do nothing`);
  staff[st.key] = u;
}

if (staff.admin.created) {
  const who = async (key: string) => (await demoUser(key, "", "work")).actor; // existing users: name unused
  const amira = await who("amira");
  const lea = await who("lea");
  const sami = await who("sami");
  const nour = await who("nour");
  const youssef = await who("youssef");
  const olive = (await demoUser("client-olive", "", "hire")).actor;
  const atlas = (await demoUser("client-atlas", "", "hire")).actor;
  const mod = staff.moderator.actor;
  const tier = (name: string, description: string, price: string, deliveryDays: number, revisions: number) => ({ name, description, price, deliveryDays, revisions });

  // Services (moderated through the real workflow)
  const svc = async (seller: typeof amira, input: Record<string, unknown>, publish: boolean) => {
    const l = await createService(db, seller, input);
    await db.update(serviceListings).set({ isDemo: true }).where(eq(serviceListings.id, l.id));
    await ownerTransition(db, seller, l.id, "pending_review");
    if (publish) await moderateService(db, mod.userId, l.id, "approve");
    return l;
  };
  const landing = await svc(amira, {
    title: "Responsive landing page in Next.js with tests",
    categorySlug: "web-mobile-dev",
    summary: "Synthetic demo service. A fast, accessible landing page built with Next.js and Tailwind.",
    description: "Synthetic demo service. I will build a responsive, accessible landing page in Next.js with Tailwind CSS, unit tests and a short handover document so your team can maintain it.",
    currency: "USD", maxConcurrentOrders: 3,
    tiers: { starter: tier("One section", "A single hero section with call to action", "150", 3, 1), standard: tier("Full page", "Up to five sections, contact form and SEO basics", "300", 5, 2), advanced: tier("Page + CMS", "Full page with headless CMS editing and analytics", "600", 10, 3) },
    addons: [{ name: "Copywriting for all sections", price: "50", extraDays: 1 }, { name: "Extra language version", price: "80", extraDays: 2 }],
    requirements: ["Link to your brand assets or current website", "Who is the target audience?"],
  }, true);
  await svc(lea, {
    title: "Logo and mini brand guide for a small business",
    categorySlug: "design-creative",
    summary: "Synthetic demo service. Primary logo, colour palette and a short brand guide in Figma and PDF.",
    description: "Synthetic demo service. I design a primary logo and secondary mark, an accessible colour palette and typography pairing, delivered with a short brand guide as Figma source and PDF.",
    currency: "USD", maxConcurrentOrders: 2,
    tiers: { starter: tier("Logo only", "One logo concept refined to final files", "120", 4, 1), standard: tier("Logo + palette", "Two concepts, palette and typography", "250", 6, 2), advanced: tier("Mini brand guide", "Three concepts and an 8-page brand guide", "480", 10, 3) },
    addons: [{ name: "Social media kit", price: "60", extraDays: 2 }],
    requirements: ["Business name and what you do", "Colours or styles you like or dislike"],
  }, true);
  await svc(sami, {
    title: "Image classification baseline with an evaluation report",
    categorySlug: "data-ai",
    summary: "Synthetic demo service awaiting moderation. A baseline image classifier with an honest metrics report.",
    description: "Synthetic demo service. I train a baseline image classifier on your labelled images and deliver the training script, the model and an evaluation report with per-class precision and recall and known limitations.",
    currency: "USD", maxConcurrentOrders: 2,
    tiers: { starter: tier("Baseline", "One model, up to 3 classes", "200", 5, 1), standard: tier("Tuned", "Hyperparameter search, up to 10 classes", "450", 8, 2), advanced: tier("Production-ready", "Tuned model plus inference API and docs", "900", 14, 2) },
    addons: [],
    requirements: ["How many labelled images per class do you have?"],
  }, false); // left in the moderation queue for the admin demo

  // A paid order in progress (payment confirmed by the simulated provider webhook)
  const ord = await placeOrder(db, olive, { listingId: landing.id, tier: "standard", addonIds: [] });
  await simulateTestProviderOutcome(db, olive, ord.intentId, "succeeded");
  await submitRequirements(db, olive, ord.order.id, { "1": "https://example.test/olive-brand (synthetic)", "2": "Small design studios looking for a booking tool (synthetic demo answer)" });

  // Agency with an accepted member
  const ag = await createAgency(db, amira, { name: "Spring Build Collective", description: "Synthetic demo agency. A small team of web and mobile engineers who take on product builds together." });
  await db.update(agencies).set({ isDemo: true }).where(eq(agencies.id, ag.id));
  await updateAgency(db, amira, ag.id, { name: "Spring Build Collective", description: "Synthetic demo agency. A small team of web and mobile engineers who take on product builds together." }, true);
  await inviteMember(db, amira, ag.id, "youssef@demo.workspring.test", "member");
  const [inv] = await db.select().from(agencyInvitations).where(eq(agencyInvitations.agencyId, ag.id));
  if (inv) await respondAgencyInvitation(db, youssef, inv.id, true);

  // Completed fixed-price contract with both (double-blind) reviews revealed
  const docJob = await createJob(db, olive, { title: "Review and tidy our API documentation", description: "Synthetic demo job. Review about 30 pages of REST API documentation for accuracy and consistency, fix wording and produce a short style guide for future pages.", categorySlug: "writing-translation", skills: ["technical-writing"], contractType: "fixed", currency: "USD", budgetMin: "200", budgetMax: "400", scope: "small", experienceLevel: "intermediate" });
  await db.execute(sql`update jobs set is_demo = true where id = ${docJob.id}`);
  await transitionJob(db, olive, docJob.id, "open");
  const p1 = await submitProposal(db, nour, { jobId: docJob.id, coverLetter: "Synthetic demo proposal. I review API docs regularly and can deliver a tidy set plus a short style guide within a week.", amount: "300", durationEstimate: "less_than_1_week" });
  const off1 = await createOffer(db, olive, { proposalId: p1.id, title: "API documentation review (synthetic demo)", description: "Review and tidy the REST API documentation and write a short style guide.", milestones: [{ title: "Reviewed docs and style guide", amount: "300" }] });
  const c1 = await acceptOffer(db, nour, off1.id);
  const [m1] = await db.select().from(milestones).where(eq(milestones.contractId, c1.id));
  const f1 = await fundMilestone(db, olive, m1.id);
  await simulateTestProviderOutcome(db, olive, f1.intentId, "succeeded");
  await deliverMilestone(db, nour, m1.id, { note: "Synthetic demo delivery: reviewed all pages and added a two-page style guide." });
  const r1 = await approveMilestone(db, olive, m1.id);
  await simulateTestProviderOutcome(db, olive, r1.intentId, "succeeded");
  await submitReview(db, olive, { kind: "contract", id: c1.id }, { rating: 5, body: "[Synthetic demo review] Careful, consistent edits and a useful style guide." });
  await submitReview(db, nour, { kind: "contract", id: c1.id }, { rating: 5, body: "[Synthetic demo review] Clear brief and fast feedback from the client." });

  // Active hourly contract with logged time (manual time allowed)
  const hJob = await createJob(db, atlas, { title: "Ongoing Flutter maintenance for our field app", description: "Synthetic demo job. Weekly maintenance of a Flutter field-service app: bug fixes, dependency updates and small features, tracked hourly with weekly timesheets.", categorySlug: "web-mobile-dev", skills: ["flutter"], contractType: "hourly", currency: "USD", budgetMin: "20", budgetMax: "40", scope: "medium", experienceLevel: "intermediate" });
  await db.execute(sql`update jobs set is_demo = true where id = ${hJob.id}`);
  await transitionJob(db, atlas, hJob.id, "open");
  const p2 = await submitProposal(db, youssef, { jobId: hJob.id, coverLetter: "Synthetic demo proposal. I maintain Flutter apps and can take on weekly fixes with clear time logs.", amount: "30", durationEstimate: "3_plus_months" });
  const off2 = await createOffer(db, atlas, { proposalId: p2.id, title: "Flutter maintenance (synthetic demo, hourly)", description: "Weekly Flutter maintenance: bug fixes, dependency updates and small features.", hourlyRate: "30", weeklyLimitHours: 10, allowManualTime: true });
  const c2 = await acceptOffer(db, youssef, off2.id);
  const today = new Date().toISOString().slice(0, 10);
  await addManualEntry(db, youssef, { contractId: c2.id, date: today, minutes: 90, memo: "Synthetic demo entry: fixed offline sync crash" });
  await addManualEntry(db, youssef, { contractId: c2.id, date: today, minutes: 45, memo: "Synthetic demo entry: updated dependencies" });

  // Support ticket and an abuse report so the staff queues are not empty
  await openTicket(db, olive, { subject: "How do refunds work in test mode?", category: "payments", body: "Synthetic demo ticket. Where can I see the status of a refund after a dispute?" });
  await fileReport(db, atlas, { targetType: "service", targetId: landing.id, reason: "other", details: "Synthetic demo report for the admin console walkthrough. No real issue." });
}

console.log("[seed] synthetic demo data ready. All demo accounts use password:", DEMO_PASSWORD);
console.log("  clients:     client-olive@demo.workspring.test, client-atlas@demo.workspring.test");
console.log("  freelancers:", FREELANCERS.map((f) => `${f.key}@demo.workspring.test`).join(", "));
console.log("  staff:       admin@ (superadmin), support@, moderator@, finance@demo.workspring.test");
await client.end();
