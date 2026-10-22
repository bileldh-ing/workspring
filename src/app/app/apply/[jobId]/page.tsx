import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { submitProposalAction } from "@/app/actions/marketplace";
import { ActionForm } from "@/components/action-form";
import { budgetText, DURATION_LABELS } from "@/components/labels";
import { Card, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { requireActor } from "@/lib/session";
import { getMyProfile } from "@/server/services/profiles";
import { screeningQuestionsFor } from "@/server/services/jobs";
import { FileInput } from "@/components/r2";

export const metadata = { title: "Submit a proposal" };

export default async function Apply({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const actor = await requireActor(`/app/apply/${jobId}`);
  const db = getDb();
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) notFound();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || job.status === "draft") notFound();
  const questions = await screeningQuestionsFor(db, job.id);
  const profile = actor.capabilities.includes("freelancer") ? await getMyProfile(db, actor) : null;
  const blockers: React.ReactNode[] = [];
  if (!actor.capabilities.includes("freelancer")) blockers.push(<>Add the freelancer capability in <Link className="underline" href="/app/settings">Settings</Link>.</>);
  else if (!profile || profile.status !== "published") blockers.push(<>Publish your <Link className="underline" href="/app/profile">freelancer profile</Link> first.</>);
  if (!actor.emailVerified) blockers.push(<>Verify your email address.</>);
  if (job.status !== "open") blockers.push(<>This job is not accepting proposals.</>);
  if (job.clientId === actor.userId) blockers.push(<>You can&apos;t apply to your own job.</>);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Submit a proposal" subtitle={<>For <Link href={`/jobs/${job.slug}`} className="text-brand hover:underline">{job.title}</Link> · {budgetText({ contract_type: job.contractType, budget_min_minor: job.budgetMinMinor, budget_max_minor: job.budgetMaxMinor, currency: job.currency })}</>} />
      {blockers.length ? (
        <Notice tone="warn" title="Before you can apply">
          <ul className="list-disc pl-5">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </Notice>
      ) : null}
      <Card>
        <ActionForm action={submitProposalAction} submitLabel="Send proposal" pendingLabel="Sending…">
          <input type="hidden" name="jobId" value={job.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={job.contractType === "hourly" ? `Your hourly rate (${job.currency})` : `Your fixed bid (${job.currency})`} name="amount" hint="Terms are captured as a snapshot when you send.">
              <Input name="amount" inputMode="decimal" required />
            </Field>
            <Field label="Estimated duration" name="durationEstimate">
              <Select name="durationEstimate" defaultValue="1_to_4_weeks">
                {Object.entries(DURATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Cover letter" name="coverLetter" hint="50–5000 characters. Explain your approach, ask questions, suggest next steps. No contact details.">
            <Textarea name="coverLetter" rows={9} required />
          </Field>
          {questions.length ? (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">Screening questions from the client</legend>
              {questions.map((q) => (
                <Field key={q.id} label={q.prompt} name={`answer_${q.id}`}>
                  <Textarea name={`answer_${q.id}`} rows={3} required={q.required} maxLength={2000} />
                </Field>
              ))}
            </fieldset>
          ) : null}
          <FileInput label="Attachments (optional): portfolio samples, CV" />
          <p className="text-xs text-muted">Sending a proposal is free. You can withdraw it until the client sends you an offer.</p>
        </ActionForm>
      </Card>
    </div>
  );
}
