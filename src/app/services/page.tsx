import { PageHeader, Notice, LinkButton } from "@/components/ui";

export const metadata = { title: "Services catalog" };

export default function Services() {
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Services catalog" />
      <Notice title="Not available yet (planned for Phase 7)">
        Pre-packaged services with tiers, add-ons, requirements and moderated publishing are designed but not built. Nothing on this page is for sale.
      </Notice>
      <div className="flex gap-2">
        <LinkButton href="/jobs">Find work</LinkButton>
        <LinkButton href="/talent" variant="secondary">Browse talent</LinkButton>
      </div>
    </div>
  );
}
