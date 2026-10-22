import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { getPaymentProvider } from "@/server/payments";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "WorkSpring: hire independent professionals", template: "%s · WorkSpring" },
  description: "WorkSpring is a freelance marketplace for posting jobs, sending proposals and running milestone contracts.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "WorkSpring", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#1f4fd1", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const provider = getPaymentProvider();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        {provider.mode === "test" && provider.configured ? (
          <div className="bg-warn-soft px-4 py-1.5 text-center text-xs font-semibold text-warn">
            TEST MODE: payments use a simulated provider. No real money moves. Demo records are synthetic.
          </div>
        ) : !provider.configured ? (
          <div className="bg-canvas px-4 py-1.5 text-center text-xs font-semibold text-muted">Payments are not configured on this deployment.</div>
        ) : null}
        <SiteHeader />
        <main id="main" className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted">
            <span>© 2026 WorkSpring (provisional name, pre-release software)</span>
            <Link href="/how-it-works" className="hover:text-brand">How it works</Link>
            <Link href="/fees" className="hover:text-brand">Fees</Link>
            <Link href="/trust" className="hover:text-brand">Trust &amp; payments</Link>
          </div>
        </footer>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
