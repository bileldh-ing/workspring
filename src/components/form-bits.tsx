import { CURRENCIES } from "@/domain/money";

type Skill = { id: string; slug: string; name: string; categoryId: string | null };
type Cat = { id: string; slug: string; name: string };

export function SkillPicker({ skills, categories, selected, max }: { skills: Skill[]; categories: Cat[]; selected: string[]; max: number }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">Skills (pick up to {max})</legend>
      {categories.map((c) => {
        const inCat = skills.filter((s) => s.categoryId === c.id);
        if (inCat.length === 0) return null;
        return (
          <div key={c.id}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{c.name}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {inCat.map((s) => (
                <label key={s.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="checkbox" name="skills" value={s.slug} defaultChecked={selected.includes(s.slug)} className="accent-[#1f4fd1]" />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

export function CurrencyOptions() {
  return (
    <>
      {Object.keys(CURRENCIES).map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </>
  );
}
