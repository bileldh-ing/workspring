import Link from "next/link";
import type { AdminPermission } from "@/domain/admin";
import { staffContext } from "@/lib/staff";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin console", template: "%s · Admin · WorkSpring" }, robots: { index: false } };

const NAV: { href: string; label: string; perm?: AdminPermission }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users", perm: "users.read" },
  { href: "/admin/moderation", label: "Service moderation", perm: "moderation.services" },
  { href: "/admin/reviews", label: "Reviews", perm: "moderation.reviews" },
  { href: "/admin/reports", label: "Reports", perm: "reports.handle" },
  { href: "/admin/support", label: "Support queue", perm: "support.handle" },
  { href: "/admin/payments", label: "Payments & webhooks", perm: "payments.read" },
  { href: "/admin/disputes", label: "Disputes", perm: "disputes.resolve" },
  { href: "/admin/audit", label: "Audit log", perm: "audit.read" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { roles, can } = await staffContext();
  return (
    <div className="grid gap-6 md:grid-cols-[210px_1fr]">
      <nav aria-label="Admin" className="md:sticky md:top-4 md:self-start">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Admin console</p>
        <p className="mb-2 text-xs text-muted">Roles: {roles.join(", ")}</p>
        <ul className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
            <li key={n.href}><Link href={n.href} className="block whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-brand-soft hover:text-brand">{n.label}</Link></li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}
