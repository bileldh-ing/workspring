import Link from "next/link";

export const metadata = { title: "Offline" };
export const dynamic = "force-static";

/** Served by the service worker when a navigation fails without a network connection. Never caches private data. */
export default function Offline() {
  return (
    <div className="mx-auto max-w-md space-y-3 py-10 text-center">
      <h1 className="text-2xl font-bold">You’re offline</h1>
      <p className="text-sm text-muted">WorkSpring needs a connection to load jobs, messages and contracts. Nothing private is stored on this device. Reconnect and try again.</p>
      <Link href="/" className="inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Retry</Link>
    </div>
  );
}
