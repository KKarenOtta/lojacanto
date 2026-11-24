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
