import { AppError } from "./errors";

/** ISO 4217 currencies supported in R1 and their minor-unit exponent. */
export const CURRENCIES = { USD: 2, EUR: 2, TND: 3 } as const;
export type Currency = keyof typeof CURRENCIES;
export const isCurrency = (c: string): c is Currency => Object.prototype.hasOwnProperty.call(CURRENCIES, c);

/** Largest amount accepted anywhere (1,000,000.00 in major units, per currency exponent). */
export const maxMinor = (c: Currency) => 1_000_000 * 10 ** CURRENCIES[c];

/**
 * Parses a user-entered decimal string ("1,250.5") into integer minor units without floats.
 * Rejects more fractional digits than the currency allows.
 */
export function toMinor(input: string, currency: Currency): number {
  const exp = CURRENCIES[currency];
  const s = input.trim().replace(/,/g, "");
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new AppError("VALIDATION", "Enter an amount like 250 or 250.50");
  const frac = m[2] ?? "";
  if (frac.length > exp) throw new AppError("VALIDATION", `${currency} allows at most ${exp} decimal places`);
  const minor = BigInt(m[1]) * 10n ** BigInt(exp) + BigInt(frac.padEnd(exp, "0") || "0");
  if (minor <= 0n) throw new AppError("VALIDATION", "Amount must be greater than zero");
  if (minor > BigInt(maxMinor(currency))) throw new AppError("VALIDATION", "Amount is too large");
  return Number(minor);
}

/** Formats minor units for display, e.g. formatMoney(123456, "USD") -> "$1,234.56". */
export function formatMoney(minor: number, currency: string): string {
  const exp = isCurrency(currency) ? CURRENCIES[currency] : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / 10 ** exp);
}

/** Plain decimal string for form defaults: 123456 USD -> "1234.56". */
export function minorToDecimal(minor: number, currency: Currency): string {
  const exp: number = CURRENCIES[currency];
  const neg = minor < 0;
  const s = Math.abs(minor).toString().padStart(exp + 1, "0");
  const out = exp === 0 ? s : `${s.slice(0, -exp)}.${s.slice(-exp)}`;
  return neg ? `-${out}` : out;
}

/**
 * Fee in minor units for an amount and a fee rate in basis points, rounded half-up.
 * Uses BigInt so large amounts never lose precision.
 */
export function feeMinor(amountMinor: number, bps: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new Error("amount must be a non-negative integer");
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("bps must be an integer 0..10000");
  return Number((BigInt(amountMinor) * BigInt(bps) + 5_000n) / 10_000n);
}

/** Splits a milestone release into freelancer net + platform fee; parts always sum to the gross. */
export function splitRelease(grossMinor: number, freelancerFeeBps: number) {
  const fee = feeMinor(grossMinor, freelancerFeeBps);
  return { grossMinor, feeMinor: fee, netMinor: grossMinor - fee };
}

export function sumMinor(values: number[]): number {
  return Number(values.reduce((a, v) => a + BigInt(v), 0n));
}
