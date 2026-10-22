import { adminAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { NoPermission } from "@/components/admin-bits";
import { Card, EmptyState, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { staffContext } from "@/lib/staff";
import { getPaymentProvider } from "@/server/payments";
import { paymentLog } from "@/server/services/admin";

export const metadata = { title: "Payments & webhooks" };

export default async function Payments() {
  const { actor, can } = await staffContext("/admin/payments");
  if (!can("payments.read")) return <NoPermission perm="payments.read" />;
  const { intents, events } = await paymentLog(getDb(), actor);
  const provider = getPaymentProvider();
  return (
    <>
      <PageHeader title="Payments & webhooks" subtitle="Payment intents created through the provider adapter and every provider webhook received (verified or rejected). Read-only." />
      <Card className="overflow-x-auto">
        <h2 className="mb-2 font-semibold">Payment intents (latest 100)</h2>
        {intents.length === 0 ? <EmptyState title="No payment intents yet" /> : (
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-line"><th className="py-1 pr-2">Created</th><th className="pr-2">Purpose</th><th className="pr-2">Amount</th><th className="pr-2">Fee</th><th className="pr-2">Mode</th><th className="pr-2">Status</th><th>Provider ref</th></tr></thead>
            <tbody>
              {intents.map((i) => (
                <tr key={i.id} className="border-b border-line align-top">
                  <td className="py-1 pr-2">{formatDate(i.createdAt)}</td><td className="pr-2">{i.purpose.replace(/_/g, " ")}</td><td className="pr-2">{formatMoney(i.amountMinor, i.currency)}</td><td className="pr-2">{formatMoney(i.feeMinor, i.currency)}</td><td className="pr-2">{i.mode}</td>
                  <td className="pr-2"><StatusBadge status={i.status} />
                    {i.purpose === "milestone_refund" && i.status === "requires_action" && provider.mode === "test" && can("disputes.resolve") ? (
                      <ActionForm action={adminAction} submitLabel="Simulate refund succeeded" variant="ghost" inline><input type="hidden" name="op" value="simulate_refund" /><input type="hidden" name="intentId" value={i.id} /><input type="hidden" name="outcome" value="succeeded" /></ActionForm>
                    ) : null}
                  </td>
                  <td><code>{i.providerRef ?? "-"}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card className="overflow-x-auto">
        <h2 className="mb-2 font-semibold">Provider webhook events (latest 100)</h2>
        {events.length === 0 ? <EmptyState title="No webhook events yet" /> : (
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-line"><th className="py-1 pr-2">Received</th><th className="pr-2">Provider</th><th className="pr-2">Event</th><th className="pr-2">Type</th><th>Outcome</th></tr></thead>
            <tbody>{events.map((e) => <tr key={e.id} className="border-b border-line"><td className="py-1 pr-2">{formatDate(e.receivedAt)}</td><td className="pr-2">{e.provider}</td><td className="pr-2"><code>{e.eventId}</code></td><td className="pr-2">{e.type}</td><td>{e.outcome}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
