import Link from "next/link";
import { logoutAction, switchModeAction } from "@/app/actions/auth";
import { getActor } from "@/lib/session";
import { Logo } from "./logo";
import { buttonClass } from "./ui";

const publicLinks = [
  { href: "/talent", label: "Browse talent" },
  { href: "/jobs", label: "Find work" },
  { href: "/services", label: "Services" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/fees", label: "Fees" },
];

export async function SiteHeader() {
  const actor = await getActor();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" aria-label="WorkSpring home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="order-3 w-full overflow-x-auto md:order-none md:w-auto">
          <ul className="flex gap-4 text-sm font-medium text-ink-soft">
            {publicLinks.map((l) => (
              <li key={l.href}>
                <Link className="whitespace-nowrap hover:text-brand" href={l.href}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {actor ? (
            <>
              {actor.capabilities.includes("client") && actor.capabilities.includes("freelancer") ? (
                <form action={switchModeAction}>
                  <input type="hidden" name="mode" value={actor.activeMode === "client" ? "freelancer" : "client"} />
                  <button className={buttonClass("ghost", "px-2 py-1 text-xs")} title="Switch workspace">
                    {actor.activeMode === "client" ? "Client" : "Freelancer"} mode · switch
                  </button>
                </form>
              ) : null}
              <Link href="/app" className={buttonClass("secondary", "px-3 py-1.5")}>
                Workspace
              </Link>
              <form action={logoutAction}>
                <button className={buttonClass("ghost", "px-3 py-1.5")}>Sign out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/signin" className={buttonClass("ghost", "px-3 py-1.5")}>
                Sign in
              </Link>
              <Link href="/join" className={buttonClass("primary", "px-3 py-1.5")}>
                Join
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
