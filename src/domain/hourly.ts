/** Pure helpers for hourly contracts. All times are UTC; weeks start Monday 00:00 UTC. */

export function weekStartOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

export function weekRange(weekStart: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error("weekStart must be YYYY-MM-DD");
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  if (weekStartOf(start) !== weekStart) throw new Error("weekStart must be a Monday");
  const end = new Date(start.getTime() + 7 * 86400_000);
  return { start, end };
}

/**
 * Timer rounding rule (documented in TIME_TRACKING_PRIVACY.md): elapsed time is rounded to the nearest whole
 * minute, with a minimum of 1 minute for any stopped session. Sub-30-second sessions still count as 1 minute
 * so a stop is never silently discarded; the freelancer can delete it.
 */
export function roundMinutes(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) throw new Error("Invalid duration");
  return Math.max(1, Math.round(ms / 60_000));
}

/** Billable amount for minutes at an hourly rate, rounded half-up to the minor unit. */
export function billableMinor(minutes: number, hourlyRateMinor: number): number {
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error("minutes must be a non-negative integer");
  if (!Number.isInteger(hourlyRateMinor) || hourlyRateMinor <= 0) throw new Error("rate must be a positive integer");
  return Math.floor((minutes * hourlyRateMinor + 30) / 60);
}

/** Whether adding `addMinutes` to an existing weekly total stays within the contract's weekly limit. */
export function withinWeeklyLimit(existingMinutes: number, addMinutes: number, limitMinutes: number | null): boolean {
  if (limitMinutes === null) return true;
  return existingMinutes + addMinutes <= limitMinutes;
}

export const formatMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
