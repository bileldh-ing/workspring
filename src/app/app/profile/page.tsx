import Link from "next/link";
import { saveProfileAction, setProfileVisibilityAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { CurrencyOptions, SkillPicker } from "@/components/form-bits";
import { AVAILABILITY_LABELS, LEVEL_LABELS } from "@/components/labels";
import { Card, Field, Input, LinkButton, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { getDb } from "@/db/client";
import { minorToDecimal, isCurrency } from "@/domain/money";
import { requireActor } from "@/lib/session";
import { getMyProfile } from "@/server/services/profiles";
import { listCategories, listSkills } from "@/server/services/taxonomy";

export const metadata = { title: "Your profile" };

export default async function ProfileEditor({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const actor = await requireActor();
  const { welcome } = await searchParams;
  if (!actor.capabilities.includes("freelancer")) {
    return (
      <div className="max-w-xl space-y-3">
        <PageHeader title="Freelancer profile" />
        <Notice>Your account doesn&apos;t offer services yet. Add the freelancer capability in <Link href="/app/settings" className="underline">Settings</Link> (same login).</Notice>
      </div>
    );
  }
  const db = getDb();
  const [profile, categories, skills] = await Promise.all([getMyProfile(db, actor), listCategories(db), listSkills(db)]);
  const rate = profile?.hourlyRateMinor && isCurrency(profile.currency) ? minorToDecimal(profile.hourlyRateMinor, profile.currency) : "";
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Your freelancer profile"
        subtitle={profile ? <span className="inline-flex items-center gap-2">Status: <StatusBadge status={profile.status} /></span> : "Not created yet"}
        actions={profile?.status === "published" ? <LinkButton variant="secondary" href={`/freelancers/${profile.slug}`}>View public profile</LinkButton> : null}
      />
      {welcome ? <Notice tone="success">Account created. Build your profile, verify your email, then publish.</Notice> : null}
      <Card>
        <ActionForm action={saveProfileAction} submitLabel={profile ? "Save changes" : "Save draft profile"}>
          <Field label="Professional headline" name="title" hint="5–120 characters, e.g. “Full-stack TypeScript engineer”.">
            <Input name="title" defaultValue={profile?.title ?? ""} required maxLength={120} />
          </Field>
          <Field label="Overview" name="overview" hint="50–5000 characters. Describe what you do and for whom. Don't include contact details.">
            <Textarea name="overview" defaultValue={profile?.overview ?? ""} rows={7} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Hourly rate" name="hourlyRate">
              <Input name="hourlyRate" inputMode="decimal" defaultValue={rate} required />
            </Field>
            <Field label="Currency" name="currency">
              <Select name="currency" defaultValue={profile?.currency ?? "USD"}><CurrencyOptions /></Select>
            </Field>
            <Field label="Time zone" name="timezone" hint="IANA name, e.g. Africa/Tunis">
              <Input name="timezone" defaultValue={profile?.timezone ?? "UTC"} required />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Availability" name="availability">
              <Select name="availability" defaultValue={profile?.availability ?? "available"}>
                {Object.entries(AVAILABILITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Experience level" name="experienceLevel">
              <Select name="experienceLevel" defaultValue={profile?.experienceLevel ?? "intermediate"}>
                {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Primary category" name="categorySlug">
              <Select name="categorySlug" defaultValue={profile?.categorySlug ?? ""}>
                <option value="">Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <SkillPicker skills={skills} categories={categories} selected={profile?.skills.map((s) => s.slug) ?? []} max={15} />
        </ActionForm>
      </Card>
      {profile ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-semibold">Visibility</p>
            <p className="text-muted">{profile.status === "published" ? "Your profile appears in talent search and can be viewed publicly." : "Publishing requires a verified email and a complete profile."}</p>
          </div>
          <ActionForm action={setProfileVisibilityAction} submitLabel={profile.status === "published" ? "Hide profile" : "Publish profile"} variant={profile.status === "published" ? "secondary" : "accent"} inline>
            <input type="hidden" name="publish" value={profile.status === "published" ? "0" : "1"} />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
