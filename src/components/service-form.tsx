import { CurrencyOptions } from "./form-bits";
import { Field, Input, Select, Textarea } from "./ui";

type Tier = { tier: string; name: string; description: string; priceMinor: number; deliveryDays: number; revisions: number };
type Initial = {
  title: string; categorySlug: string; summary: string; description: string; currency: string; maxConcurrentOrders: number;
  tiers: Tier[]; addons: { name: string; priceMinor: number; extraDays: number }[]; requirements: { prompt: string }[];
};
const TIERS = ["starter", "standard", "advanced"] as const;
const exp = (c: string) => (c === "TND" ? 3 : 2);
const dec = (minor: number, c: string) => (minor / 10 ** exp(c)).toFixed(exp(c));

/** Fields for createServiceAction/updateServiceAction (names match serviceFrom() in actions/r2.ts). */
export function ServiceFields({ categories, initial }: { categories: { id: string; slug: string; name: string }[]; initial?: Initial }) {
  const cur = initial?.currency ?? "USD";
  const tier = (t: string) => initial?.tiers.find((x) => x.tier === t);
  const addons = [0, 1, 2].map((i) => initial?.addons[i]);
  const reqs = [0, 1, 2, 3, 4].map((i) => initial?.requirements[i]?.prompt ?? "");
  return (
    <>
      <Field label="Title" name="title" hint="10–120 characters, e.g. “I will build a responsive landing page in Next.js”"><Input name="title" defaultValue={initial?.title} required minLength={10} maxLength={120} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category" name="categorySlug">
          <Select name="categorySlug" defaultValue={initial?.categorySlug ?? ""} required>
            <option value="" disabled>Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Currency" name="currency"><Select name="currency" defaultValue={cur}><CurrencyOptions /></Select></Field>
        <Field label="Max concurrent orders" name="maxConcurrentOrders"><Input name="maxConcurrentOrders" type="number" min={1} max={50} defaultValue={initial?.maxConcurrentOrders ?? 3} /></Field>
      </div>
      <Field label="Summary" name="summary" hint="20–300 characters, shown in search results"><Textarea name="summary" rows={2} defaultValue={initial?.summary} required /></Field>
      <Field label="Description" name="description" hint="50+ characters. No email addresses or phone numbers."><Textarea name="description" rows={6} defaultValue={initial?.description} required /></Field>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Packages (each must cost at least as much as the previous one)</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {TIERS.map((t) => {
            const v = tier(t);
            return (
              <div key={t} className="space-y-2 rounded-md border border-line p-3">
                <p className="text-sm font-semibold capitalize">{t}</p>
                <Field label="Name" name={`${t}_name`}><Input name={`${t}_name`} defaultValue={v?.name} /></Field>
                <Field label="What's included" name={`${t}_description`}><Textarea name={`${t}_description`} rows={3} defaultValue={v?.description} /></Field>
                <Field label="Price" name={`${t}_price`}><Input name={`${t}_price`} inputMode="decimal" defaultValue={v ? dec(v.priceMinor, cur) : ""} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Days" name={`${t}_days`}><Input name={`${t}_days`} type="number" min={1} max={90} defaultValue={v?.deliveryDays ?? ""} /></Field>
                  <Field label="Revisions" name={`${t}_revisions`}><Input name={`${t}_revisions`} type="number" min={0} max={10} defaultValue={v?.revisions ?? 1} /></Field>
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Add-ons (optional, leave blank to skip)</legend>
        {addons.map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_120px_100px] gap-2">
            <Input name="addon_name" aria-label={`Add-on ${i + 1} name`} placeholder="Add-on name" defaultValue={a?.name ?? ""} />
            <Input name="addon_price" aria-label={`Add-on ${i + 1} price`} placeholder="Price" inputMode="decimal" defaultValue={a ? dec(a.priceMinor, cur) : ""} />
            <Input name="addon_days" aria-label={`Add-on ${i + 1} extra days`} placeholder="+days" type="number" min={0} max={30} defaultValue={a?.extraDays ?? ""} />
          </div>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Requirements you'll ask the buyer after payment (optional)</legend>
        {reqs.map((r, i) => <Input key={i} name="requirement" aria-label={`Requirement ${i + 1}`} placeholder={i === 0 ? "e.g. Link to your brand guidelines" : ""} defaultValue={r} />)}
      </fieldset>
    </>
  );
}
