import Link from "next/link";
import { createJobAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { JobFields } from "@/components/job-form";
import { Card, Notice, PageHeader } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireActor } from "@/lib/session";
import { listCategories, listSkills } from "@/server/services/taxonomy";

export const metadata = { title: "Post a job" };

export default async function NewJob() {
  const actor = await requireActor("/app/jobs/new");
  if (!actor.capabilities.includes("client")) {
    return <Notice>Add the client capability in <Link className="underline" href="/app/settings">Settings</Link> to post jobs (same login).</Notice>;
  }
  const db = getDb();
  const [categories, skills] = await Promise.all([listCategories(db), listSkills(db)]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Post a job" subtitle="Saved as a draft first. You'll preview it and publish from the next screen." />
      <Card>
        <ActionForm action={createJobAction} submitLabel="Save draft">
          <JobFields categories={categories} skills={skills} />
        </ActionForm>
      </Card>
    </div>
  );
}
