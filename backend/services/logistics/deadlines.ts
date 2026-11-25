export type DeadlineLevel = "ok" | "warning" | "critical" | "overdue";

export interface DeadlinePolicy {
  warningHours: number;
  criticalHours: number;
}

const HOUR_MS = 3_600_000;
export const DCE_WINDOW_HOURS = 72;

export function deadlineLevel(deadline: string, now: Date, policy: DeadlinePolicy): DeadlineLevel {
  if (policy.criticalHours <= 0 || policy.warningHours <= policy.criticalHours) {
    throw new RangeError("warningHours must exceed criticalHours, both positive");
  }
  const due = Date.parse(deadline);
  if (Number.isNaN(due)) throw new RangeError("invalid deadline");
  const remaining = due - now.getTime();
  if (remaining <= 0) return "overdue";
  if (remaining <= policy.criticalHours * HOUR_MS) return "critical";
  if (remaining <= policy.warningHours * HOUR_MS) return "warning";
  return "ok";
}

export function dceDeadline(soldAt: string): string {
  const sold = Date.parse(soldAt);
  if (Number.isNaN(sold)) throw new RangeError("invalid sale date");
  return new Date(sold + DCE_WINDOW_HOURS * HOUR_MS).toISOString();
}

const SAO_PAULO_OFFSET_MS = -3 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;

function assertCutoffHour(hour: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError("invalid cutoff hour");
}

function isBusinessDay(localMidnight: number): boolean {
  const weekday = new Date(localMidnight).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

function nextBusinessDay(localMidnight: number): number {
  let day = localMidnight + DAY_MS;
  while (!isBusinessDay(day)) day += DAY_MS;
  return day;
}

function localDay(instant: number): { midnight: number; hour: number } {
  const local = instant + SAO_PAULO_OFFSET_MS;
  const midnight = Math.floor(local / DAY_MS) * DAY_MS;
  return { midnight, hour: (local - midnight) / HOUR_MS };
}

export function nextSupplierCutoff(from: string, cutoffHour: number): string {
  assertCutoffHour(cutoffHour);
  const instant = Date.parse(from);
  if (Number.isNaN(instant)) throw new RangeError("invalid date");
  const { midnight, hour } = localDay(instant);
  const day = isBusinessDay(midnight) && hour < cutoffHour ? midnight : nextBusinessDay(midnight);
  return new Date(day + cutoffHour * HOUR_MS - SAO_PAULO_OFFSET_MS).toISOString();
}

export function expectedPostingDate(
  paidAt: string,
  cutoffHour: number,
  handlingDays: number,
): string {
  if (!Number.isInteger(handlingDays) || handlingDays < 0) {
    throw new RangeError("invalid handling days");
  }
  const cutoff = Date.parse(nextSupplierCutoff(paidAt, cutoffHour));
  let { midnight } = localDay(cutoff);
  for (let i = 0; i < handlingDays; i++) midnight = nextBusinessDay(midnight);
  return new Date(midnight).toISOString().slice(0, 10);
}
