import { assertCents } from "./rates.ts";

export interface CashMovement {
  date: string;
  amountCents: number;
}

export interface CashProjection {
  peakNeedCents: number;
  peakDate: string | null;
  endingBalanceCents: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toDay(date: string): number {
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new RangeError(`invalid date ${date}`);
  }
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

export function cashCycleDays(supplierPaidOn: string, releasedOn: string): number {
  return toDay(releasedOn) - toDay(supplierPaidOn);
}

export function projectCash(
  openingBalanceCents: number,
  movements: CashMovement[],
): CashProjection {
  assertCents(openingBalanceCents, "openingBalanceCents");
  const byDay = new Map<string, number>();
  for (const movement of movements) {
    toDay(movement.date);
    assertCents(movement.amountCents, "amountCents");
    byDay.set(movement.date, (byDay.get(movement.date) ?? 0) + movement.amountCents);
  }
  let balance = openingBalanceCents;
  let lowest = openingBalanceCents;
  let lowestDate: string | null = null;
  for (const date of [...byDay.keys()].sort()) {
    balance += byDay.get(date)!;
    if (balance < lowest) {
      lowest = balance;
      lowestDate = date;
    }
  }
  return {
    peakNeedCents: lowest < 0 ? -lowest : 0,
    peakDate: lowest < 0 ? lowestDate : null,
    endingBalanceCents: balance,
  };
}

export function canFundPurchase(
  openingBalanceCents: number,
  committed: CashMovement[],
  purchase: CashMovement,
  reserveCents: number,
): boolean {
  assertCents(reserveCents, "reserveCents");
  const outflows = [...committed, purchase].filter((movement) => movement.amountCents < 0);
  const inflowsBefore = committed.filter((movement) =>
    movement.amountCents > 0 && movement.date <= purchase.date
  );
  return projectCash(openingBalanceCents - reserveCents, [...outflows, ...inflowsBefore])
    .peakNeedCents === 0;
}
