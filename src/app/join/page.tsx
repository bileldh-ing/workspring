import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";
import { getActor } from "@/lib/session";

export const metadata = { title: "Join" };

export default async function Join({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  if (await getActor()) redirect("/app");
  const { intent } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Create your WorkSpring account</h1>
      <Card>
        <ActionForm action={registerAction} submitLabel="Create account" pendingLabel="Creating…">
          <fieldset>
            <legend className="text-sm font-medium text-ink">How do you want to start?</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                ["hire", "I want to hire"],
                ["work", "I want to offer services"],
              ].map(([v, l]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-line-strong p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="radio" name="intent" value={v} defaultChecked={(intent ?? "hire") === v} required />
                  {l}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">You can add the other side later with the same login.</p>
          </fieldset>
          <Field label="Your name" name="displayName" hint="Shown on your profile and in messages.">
            <Input name="displayName" autoComplete="name" required minLength={2} />
          </Field>
          <Field label="Email" name="email">
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" name="password" hint="At least 10 characters.">
            <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
        </ActionForm>
        <p className="mt-4 text-sm text-muted">
          Already have an account? <Link href="/signin" className="text-brand hover:underline">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}
