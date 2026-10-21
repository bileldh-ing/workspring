import { CurrencyOptions, SkillPicker } from "./form-bits";
import { LEVEL_LABELS, SCOPE_LABELS } from "./labels";
import { Field, Input, Notice, Select, Textarea } from "./ui";

type Skill = { id: string; slug: string; name: string; categoryId: string | null };
type Cat = { id: string; slug: string; name: string };
export type JobDefaults = {
  title?: string; description?: string; categorySlug?: string; skills?: string[]; contractType?: string; currency?: string;
  budgetMin?: string; budgetMax?: string; scope?: string; experienceLevel?: string; locationNote?: string;
};

/** Job post fields (server component; rendered inside an ActionForm). */
export function JobFields({ categories, skills, d = {} }: { categories: Cat[]; skills: Skill[]; d?: JobDefaults }) {
  return (
    <>
      <Notice tone="warn">Don&apos;t include personal contact details, external contact links or requests to pay outside WorkSpring. Share those only once a contract starts.</Notice>
      <Field label="Job title" name="title" hint="10–120 characters. Be specific: “React developer for invoicing dashboard”.">
        <Input name="title" defaultValue={d.title} required maxLength={120} />
      </Field>
      <Field label="Category" name="categorySlug">
        <Select name="categorySlug" defaultValue={d.categorySlug ?? ""}>
          <option value="">Choose…</option>
          {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Description, deliverables and success criteria" name="description" hint="50–10,000 characters.">
        <Textarea name="description" rows={8} defaultValue={d.description} required />
      </Field>
      <SkillPicker categories={categories} skills={skills} selected={d.skills ?? []} max={10} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contract type" name="contractType" hint="Hourly contracts can be posted, but hourly offers/time tracking arrive in a later phase.">
          <Select name="contractType" defaultValue={d.contractType ?? "fixed"}>
            <option value="fixed">Fixed price (milestones)</option>
            <option value="hourly">Hourly</option>
          </Select>
        </Field>
        <Field label="Currency" name="currency">
          <Select name="currency" defaultValue={d.currency ?? "USD"}><CurrencyOptions /></Select>
        </Field>
        <Field label="Budget minimum (optional)" name="budgetMin">
          <Input name="budgetMin" inputMode="decimal" defaultValue={d.budgetMin} />
        </Field>
        <Field label="Budget maximum (or hourly max)" name="budgetMax">
          <Input name="budgetMax" inputMode="decimal" defaultValue={d.budgetMax} required />
        </Field>
        <Field label="Project scope" name="scope">
          <Select name="scope" defaultValue={d.scope ?? "small"}>
            {Object.entries(SCOPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Experience level" name="experienceLevel">
          <Select name="experienceLevel" defaultValue={d.experienceLevel ?? "intermediate"}>
            {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Location or time-zone preference (optional)" name="locationNote" hint="Only if genuinely needed, e.g. “4h overlap with CET”.">
        <Input name="locationNote" defaultValue={d.locationNote} maxLength={200} />
      </Field>
    </>
  );
}
