import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, Notice } from "@/components/ui";
import { getActor, safeNext } from "@/lib/session";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  if (await getActor()) redirect(safeNext(sp.next));
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Sign in</h1>
      {sp.reset ? <div className="mb-4"><Notice tone="success">Password updated. Sign in with your new password.</Notice></div> : null}
      <Card>
        <ActionForm action={loginAction} submitLabel="Sign in" pendingLabel="Signing in…">
          <input type="hidden" name="next" value={safeNext(sp.next)} />
          <Field label="Email" name="email">
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" name="password">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
        </ActionForm>
        <div className="mt-4 flex justify-between text-sm">
          <Link href="/forgot-password" className="text-brand hover:underline">Forgot password?</Link>
          <Link href="/join" className="text-brand hover:underline">Create an account</Link>
        </div>
      </Card>
    </div>
  );
}
