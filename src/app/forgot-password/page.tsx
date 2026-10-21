import { forgotPasswordAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";

export const metadata = { title: "Forgot password" };

export default function ForgotPassword() {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Reset your password</h1>
      <Card>
        <ActionForm action={forgotPasswordAction} submitLabel="Send reset link">
          <Field label="Email" name="email">
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
