import Link from "next/link";
import { createServiceAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { ServiceFields } from "@/components/service-form";
import { Card, Notice, PageHeader } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/session";
import { listCategories } from "@/server/services/taxonomy";

export const metadata = { title: "New service" };

export default async function NewService() {
  const actor = await requireActor("/app/services/new");
  if (!actor.capabilities.includes("freelancer")) return <Notice tone="warn">Selling services needs freelancer capability. Add it from <Link className="underline" href="/app/settings">Settings</Link>.</Notice>;
  const cats = await listCategories(getDb());
  return (
    <>
      <PageHeader title="New service" subtitle="Saved as a draft. Nothing is public until a moderator approves it." />
      <Card>
        <ActionForm action={createServiceAction} submitLabel="Save draft" pendingLabel="Saving…">
          <ServiceFields categories={cats} />
        </ActionForm>
      </Card>
    </>
  );
}
