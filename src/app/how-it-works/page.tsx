import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "How it works" };

const steps = [
  ["Create one account", "Start as a client or a freelancer. You can add the other capability later from Settings; it is the same login, never a second account."],
  ["Verify your email", "Posting jobs, sending proposals and making offers require a verified email address."],
  ["Clients post jobs", "Draft, publish, pause, reopen or close. Only published jobs appear in search."],
  ["Freelancers publish a profile and apply", "Proposals carry your rate or fixed bid, a duration estimate and a cover letter. You can withdraw while the client hasn't sent an offer."],
  ["Talk in private conversations", "Clients open a conversation from a proposal. Only the two participants can read or post."],
  ["Offer and acceptance", "The client sends fixed-price milestones. Nothing starts until the freelancer explicitly accepts; the accepted terms are an immutable snapshot."],
  ["Milestone workroom", "Fund → deliver → request revision → approve → release. Funding and release only change state when the payment provider confirms through a verified webhook."],
];

export default function HowItWorks() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="How WorkSpring works" subtitle="What exists today in this pre-release build, and nothing more." />
      <ol className="space-y-3">
        {steps.map(([t, d], i) => (
          <li key={t}>
            <Card>
              <p className="font-semibold text-ink">
                {i + 1}. {t}
              </p>
              <p className="mt-1 text-sm text-ink-soft">{d}</p>
            </Card>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-muted">
        Planned for later phases (not available yet): hourly contracts and time tracking, the services catalog, agencies and teams, interviews and video, reviews,
        disputes and support, and identity verification.
      </p>
    </div>
  );
}
