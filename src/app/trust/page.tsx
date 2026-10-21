import { PageHeader, Card } from "@/components/ui";
import { getPaymentProvider } from "@/server/payments";

export const metadata = { title: "Trust & payments" };

export default function Trust() {
  const p = getPaymentProvider();
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Trust & payments" subtitle="Plain statements about what WorkSpring does and does not do today." />
      <Card className="space-y-2 text-sm text-ink-soft">
        <p>
          <strong className="text-ink">Payment provider:</strong> {p.label}
          {p.unavailableReason ? ` (${p.unavailableReason})` : ""}.
        </p>
        <p>WorkSpring does <strong>not</strong> offer escrow, payment protection or safeguarded funds. A milestone shown as &ldquo;funded&rdquo; means the configured provider confirmed a payment via a signed webhook; in test mode no real money exists.</p>
        <p>There are no verification badges, ratings or &ldquo;top talent&rdquo; labels. Profiles only show the number of contracts actually completed on WorkSpring.</p>
        <p>Records marked &ldquo;Synthetic demo&rdquo; were created by the seed script and are not real people, companies or jobs.</p>
        <p>Share contact or payment details only after a contract starts. Report anything suspicious; abuse reporting tools are planned.</p>
      </Card>
    </div>
  );
}
