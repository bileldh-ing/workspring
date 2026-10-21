import { resetPasswordAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, Notice } from "@/components/ui";

export const metadata = { title: "Choose a new password" };

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Choose a new password</h1>
      {!token ? (
        <Notice tone="warn">This page needs the link from your reset email.</Notice>
      ) : (
        <Card>
          <ActionForm action={resetPasswordAction} submitLabel="Update password">
            <input type="hidden" name="token" value={token} />
            <Field label="New password" name="password" hint="At least 10 characters. All other sessions will be signed out.">
              <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
            </Field>
            <Field label="Confirm new password" name="confirm">
              <Input name="confirm" type="password" autoComplete="new-password" required />
            </Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
