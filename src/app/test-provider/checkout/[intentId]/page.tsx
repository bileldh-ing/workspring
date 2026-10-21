import Link from "next/link";
import { notFound } from "next/navigation";
import { simulateProviderAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { Card, Notice, StatusBadge, TestModeBadge } from "@/components/ui";
import { getDb } from "@/db/client";
import { isAppError } from "@/domain/errors";
import { formatMoney } from "@/domain/money";
import { requireActor } from "@/lib/session";
import { getPaymentProvider } from "@/server/payments";
import { getIntentForParticipant } from "@/server/services/payments";

export const metadata = { title: "Test checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Simulated provider-hosted checkout (TEST MODE ONLY). Choosing an outcome makes the test provider emit an
 * HMAC-signed webhook that is verified and processed exactly like an external one. This page never marks
 * anything as paid by itself.
 */
export default async function TestCheckout({ params }: { params: Promise<{ intentId: string }> }) {
  const provider = getPaymentProvider();
  if (provider.id !== "test" || !provider.configured) notFound();
  const { intentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(intentId)) notFound();
  const actor = await requireActor(`/test-provider/checkout/${intentId}`);
  let row;
  try {
    row = await getIntentForParticipant(getDb(), actor, intentId);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const back = `/app/contracts/${row.c.id}`;
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2"><h1 className="text-2xl font-bold">Simulated provider checkout</h1><TestModeBadge /></div>
      <Notice tone="warn">This is not a real payment page. No card is collected and no money moves. It stands in for a provider-hosted checkout so the webhook flow can be exercised end to end.</Notice>
      <Card className="space-y-1 text-sm">
        <p><span className="text-muted">For:</span> Milestone {row.m.seq}: {row.m.title}</p>
        <p><span className="text-muted">Amount:</span> {formatMoney(row.i.amountMinor, row.i.currency)}</p>
        <p><span className="text-muted">Provider reference:</span> <code>{row.i.providerRef}</code></p>
        <p className="flex items-center gap-2"><span className="text-muted">Payment status:</span> <StatusBadge status={row.i.status} /></p>
      </Card>
      {row.i.status === "requires_action" || row.i.status === "processing" ? (
        <div className="flex flex-wrap gap-3">
          <ActionForm action={simulateProviderAction} submitLabel="Simulate: payment succeeded" variant="accent" inline>
            <input type="hidden" name="intentId" value={row.i.id} /><input type="hidden" name="outcome" value="succeeded" /><input type="hidden" name="back" value={back} />
          </ActionForm>
          <ActionForm action={simulateProviderAction} submitLabel="Simulate: payment failed" variant="danger" inline>
            <input type="hidden" name="intentId" value={row.i.id} /><input type="hidden" name="outcome" value="failed" /><input type="hidden" name="back" value={back} />
          </ActionForm>
        </div>
      ) : (
        <Notice>This payment is already final.</Notice>
      )}
      <Link href={back} className="text-sm font-semibold text-brand hover:underline">← Back to the workroom</Link>
    </div>
  );
}
