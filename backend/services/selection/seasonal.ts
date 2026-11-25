export interface SeasonWindow {
  name: string;
  startMonth: number;
  endMonth: number;
  leadWeeks: number;
}

export type SeasonPhase = "in_season" | "lead" | "off_season";

export const BACK_TO_SCHOOL: SeasonWindow = {
  name: "volta_as_aulas",
  startMonth: 11,
  endMonth: 2,
  leadWeeks: 6,
};

const SAO_PAULO_OFFSET_MS = -3 * 3_600_000;
const WEEK_MS = 7 * 86_400_000;

function assertWindow(window: SeasonWindow): void {
  for (const month of [window.startMonth, window.endMonth]) {
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("invalid month");
  }
  if (!Number.isInteger(window.leadWeeks) || window.leadWeeks < 0 || window.leadWeeks > 26) {
    throw new RangeError("invalid lead weeks");
  }
}

function monthIn(window: SeasonWindow, month: number): boolean {
  return window.startMonth <= window.endMonth
    ? month >= window.startMonth && month <= window.endMonth
    : month >= window.startMonth || month <= window.endMonth;
}

function localMonth(instant: number): number {
  return new Date(instant + SAO_PAULO_OFFSET_MS).getUTCMonth() + 1;
}

export function seasonPhase(window: SeasonWindow, at: Date): SeasonPhase {
  assertWindow(window);
  const instant = at.getTime();
  if (Number.isNaN(instant)) throw new RangeError("invalid date");
  if (monthIn(window, localMonth(instant))) return "in_season";
  if (window.leadWeeks > 0 && monthIn(window, localMonth(instant + window.leadWeeks * WEEK_MS))) {
    return "lead";
  }
  return "off_season";
}
