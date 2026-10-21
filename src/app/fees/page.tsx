import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { platformFeeRules } from "@/db/schema";
import { Card, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Fees" };
export const dynamic = "force-dynamic";

export default async function Fees() {
  const [rule] = await getDb().select().from(platformFeeRules).where(eq(platformFeeRules.isActive, true)).orderBy(desc(platformFeeRules.version)).limit(1);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Fees" subtitle="Read live from the active, versioned fee rule." />
      {rule ? (
        <Card>
          <p className="text-sm text-muted">Fee rule v{rule.version}</p>
          <p className="mt-1 text-lg font-semibold text-ink">
            Freelancer service fee: {(rule.freelancerFeeBps / 100).toFixed(2)}% of each released milestone · Client fee: {(rule.clientFeeBps / 100).toFixed(2)}%
          </p>
          <p className="mt-2 text-sm text-ink-soft">{rule.description}</p>
        </Card>
      ) : (
        <Notice tone="warn">No fee rule is active. Offers can&apos;t be sent until one is configured.</Notice>
      )}
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
        <li>No fee to post a job, send a proposal or message.</li>
        <li>No paid application credits and no proposal boosting.</li>
        <li>The rule in force when an offer is sent is copied onto the offer and contract; later changes never alter it.</li>
        <li>Fees are calculated on the server in integer minor units (half-up rounding).</li>
      </ul>
    </div>
  );
}
