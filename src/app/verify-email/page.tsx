import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { LinkButton, Notice } from "@/components/ui";
import { verifyEmail } from "@/server/services/auth";

export const metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let ok = false;
  let message = "This page needs the link from your verification email.";
  if (token) {
    try {
      await verifyEmail(getDb(), token);
      ok = true;
      message = "Your email is verified. You can now publish, apply and send offers.";
    } catch (e) {
      if (!isAppError(e)) throw e;
      message = e.message;
    }
  }
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Email verification</h1>
      <Notice tone={ok ? "success" : "warn"}>{message}</Notice>
      <LinkButton href="/app">Go to your workspace</LinkButton>
    </div>
  );
}
