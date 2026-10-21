import Link from "next/link";
import { getDb } from "@/db/client";
import { EmptyState, LinkButton, Notice, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { requireActor } from "@/lib/session";
import { listMyJobs } from "@/server/services/jobs";

export const metadata = { title: "Manage jobs" };

export default async function MyJobs() {
  const actor = await requireActor();
  if (!actor.capabilities.includes("client")) return <Notice>Only clients have jobs. Add the client capability in <Link className="underline" href="/app/settings">Settings</Link>.</Notice>;
  const jobs = await listMyJobs(getDb(), actor);
  return (
    <div>
      <PageHeader title="Manage jobs" actions={<LinkButton href="/app/jobs/new">Post a job</LinkButton>} />
      {jobs.length === 0 ? <EmptyState title="No jobs yet" /> : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Your jobs</caption>
            <thead className="border-b border-line bg-canvas text-xs uppercase text-muted">
              <tr><th scope="col" className="px-4 py-2">Title</th><th scope="col" className="px-4 py-2">Status</th><th scope="col" className="px-4 py-2">Proposals</th><th scope="col" className="px-4 py-2">Created</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-2"><Link href={`/app/jobs/${j.id}`} className="font-medium hover:text-brand">{j.title}</Link></td>
                  <td className="px-4 py-2"><StatusBadge status={j.status} /></td>
                  <td className="px-4 py-2">{j.proposal_count}</td>
                  <td className="px-4 py-2 text-muted">{formatDate(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
