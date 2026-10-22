import Link from "next/link";
import { notFound } from "next/navigation";
import { placeOrderAction } from "@/app/actions/r2";
import { ActionForm } from "@/components/action-form";
import { ReportForm } from "@/components/r2";
import { Card, DemoBadge, Notice, TestModeBadge } from "@/components/ui";
import { getDb } from "@/db/client";
import { formatMoney } from "@/domain/money";
import { getActor } from "@/lib/session";
import { getPaymentProvider } from "@/server/payments";
import { getPublicService } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const s = await getPublicService(getDb(), (await params).slug);
  return { title: s ? s.title : "Service not found", description: s?.summary };
}

/** Public service detail: published listings only, tier picker + add-ons, checkout via the configured provider. */
export default async function ServiceDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await getPublicService(getDb(), slug);
  if (!s) notFound();
  const actor = await getActor();
  const provider = getPaymentProvider();
  const own = actor?.userId === s.freelancerId;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_340px]">
      <article className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{s.title}</h1>
          {s.isDemo ? <DemoBadge /> : null}
        </div>
        <p className="text-sm text-muted">
          by {s.sellerSlug ? <Link className="font-semibold text-brand hover:underline" href={`/freelancers/${s.sellerSlug}`}>{s.sellerName}</Link> : s.sellerName}
          {s.sellerTitle ? ` · ${s.sellerTitle}` : ""} · {s.categoryName ?? "Uncategorised"}
        </p>
        <p className="text-lg text-ink-soft">{s.summary}</p>
        <Card><h2 className="mb-1 font-semibold">About this service</h2><p className="whitespace-pre-line text-sm text-ink-soft">{s.description}</p></Card>
        <Card>
          <h2 className="mb-2 font-semibold">Compare packages</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-line"><th className="py-2 pr-3">Package</th><th className="py-2 pr-3">Price</th><th className="py-2 pr-3">Delivery</th><th className="py-2">Revisions</th></tr></thead>
              <tbody>
                {s.tiers.map((t) => (
                  <tr key={t.id} className="border-b border-line align-top">
                    <td className="py-2 pr-3"><p className="font-semibold capitalize">{t.tier}: {t.name}</p><p className="text-xs text-muted">{t.description}</p></td>
                    <td className="py-2 pr-3 font-semibold">{formatMoney(t.priceMinor, s.currency)}</td>
                    <td className="py-2 pr-3">{t.deliveryDays} day{t.deliveryDays === 1 ? "" : "s"}</td>
                    <td className="py-2">{t.revisions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        {s.requirements.length ? (
          <Card>
            <h2 className="mb-1 font-semibold">What the seller will ask you after checkout</h2>
            <ol className="list-decimal pl-5 text-sm text-ink-soft">{s.requirements.map((r) => <li key={r.id}>{r.prompt}</li>)}</ol>
          </Card>
        ) : null}
        {actor && !own ? <ReportForm targetType="service" targetId={s.id} label="Report this service" /> : null}
      </article>
      <aside className="space-y-3">
        <Card className="space-y-3" data-testid="order-box">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Order this service</h2>{provider.mode === "test" ? <TestModeBadge /> : null}</div>
          {own ? (
            <Notice>This is your own service. <Link className="underline" href={`/app/services/${s.id}`}>Edit it in your workspace</Link>.</Notice>
          ) : !actor ? (
            <Notice>
              <Link className="font-semibold underline" href={`/signin?next=/services/${s.slug}`}>Sign in</Link> or <Link className="font-semibold underline" href="/join">join as a client</Link> to order.
            </Notice>
          ) : !actor.capabilities.includes("client") ? (
            <Notice tone="warn">Ordering needs client capability. Add it from <Link className="underline" href="/app/settings">Settings</Link>.</Notice>
          ) : !provider.configured ? (
            <Notice tone="warn" title="Checkout unavailable">{provider.unavailableReason ?? "No payment provider is configured, so orders can't be paid."}</Notice>
          ) : (
            <ActionForm action={placeOrderAction} submitLabel="Continue to payment" pendingLabel="Creating order…">
              <input type="hidden" name="listingId" value={s.id} />
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Package</legend>
                {s.tiers.map((t, i) => (
                  <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-line-strong p-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                    <input type="radio" name="tier" value={t.tier} defaultChecked={i === 0} className="mt-1" data-testid={`tier-${t.tier}`} />
                    <span><span className="font-semibold capitalize">{t.tier}</span> · {formatMoney(t.priceMinor, s.currency)} · {t.deliveryDays}d · {t.revisions} rev.</span>
                  </label>
                ))}
              </fieldset>
              {s.addons.length ? (
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium">Add-ons (optional)</legend>
                  {s.addons.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="addonId" value={a.id} /> {a.name} (+{formatMoney(a.priceMinor, s.currency)}{a.extraDays ? `, +${a.extraDays}d` : ""})
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <p className="text-xs text-muted">
                {provider.mode === "test" ? "Test mode: you'll go to a simulated provider checkout. No real money moves. " : ""}
                The order starts only after the payment provider confirms payment by a verified webhook. Price, package and fee rule are frozen at checkout.
              </p>
            </ActionForm>
          )}
        </Card>
        <p className="text-xs text-muted">Payments are held by the payment provider, not by WorkSpring. See <Link href="/fees" className="underline">fees</Link> and <Link href="/trust" className="underline">trust & safety</Link>.</p>
      </aside>
    </div>
  );
}
