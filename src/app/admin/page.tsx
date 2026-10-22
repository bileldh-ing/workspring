import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import { getDb } from "@/db/client";
import { staffContext } from "@/lib/staff";
import { getPaymentProvider } from "@/server/payments";
import { dashboardCounts } from "@/server/services/admin";

export const metadata = { title: "Overview" };

export default async function AdminHome() {
  const { can } = await staffContext();
  const c = await dashboardCounts(getDb());
  const provider = getPaymentProvider();
  const tiles: { label: string; value: number; href: string; show: boolean }[] = [
    { label: "Users", value: c.users, href: "/admin/users", show: can("users.read") },
    { label: "Services awaiting review", value: c.pendingServices, href: "/admin/moderation", show: can("moderation.services") },
    { label: "Open reports", value: c.openReports, href: "/admin/reports", show: can("reports.handle") },
    { label: "Open support tickets", value: c.openTickets, href: "/admin/support", show: can("support.handle") },
    { label: "Open disputes", value: c.openDisputes, href: "/admin/disputes", show: can("disputes.resolve") },
    { label: "Provider webhook events", value: c.webhookEvents, href: "/admin/payments", show: can("payments.read") },
  ];
  return (
    <>
      <PageHeader title="Admin console" subtitle="Every staff action here is authorized by role and written to the audit log." />
      <Notice tone={provider.mode === "test" ? "warn" : "info"}>Payment provider: <strong>{provider.id}</strong> ({provider.mode} mode{provider.configured ? "" : ", not configured"}). {provider.mode === "test" ? "No real money moves." : ""}</Notice>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.filter((t) => t.show).map((t) => (
          <li key={t.label}><Link href={t.href}><Card className="hover:border-brand"><p className="text-3xl font-bold" data-testid={`tile-${t.href.split("/").pop()}`}>{t.value}</p><p className="text-sm text-muted">{t.label}</p></Card></Link></li>
        ))}
      </ul>
    </>
  );
}
