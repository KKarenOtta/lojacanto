import { assertBps, assertCents, rateOf } from "./rates.ts";

export const ENTRY_KINDS = [
  "revenue",
  "sale_fee",
  "seller_shipping",
  "product_cost",
  "supplier_shipping",
  "tax",
  "refund",
] as const;

export type EntryKind = typeof ENTRY_KINDS[number];
export type Amounts = Partial<Record<EntryKind, number>>;

export interface Divergence {
  kind: EntryKind;
  estimatedCents: number | null;
  realizedCents: number | null;
  differenceCents: number | null;
  differenceBps: number | null;
  withinTolerance: boolean;
}

export function reconcile(
  estimated: Amounts,
  realized: Amounts,
  toleranceBps: number,
): Divergence[] {
  assertBps(toleranceBps, "toleranceBps");
  return ENTRY_KINDS.filter((kind) => estimated[kind] !== undefined || realized[kind] !== undefined)
    .map((kind) => {
      const expected = estimated[kind] ?? null;
      const actual = realized[kind] ?? null;
      if (expected !== null) assertCents(expected, `estimated.${kind}`);
      if (actual !== null) assertCents(actual, `realized.${kind}`);
      if (expected === null || actual === null) {
        return {
          kind,
          estimatedCents: expected,
          realizedCents: actual,
          differenceCents: null,
          differenceBps: null,
          withinTolerance: false,
        };
      }
      const difference = actual - expected;
      const bps = expected === 0
        ? (difference === 0 ? 0 : null)
        : rateOf(Math.abs(difference), Math.abs(expected));
      return {
        kind,
        estimatedCents: expected,
        realizedCents: actual,
        differenceCents: difference,
        differenceBps: bps,
        withinTolerance: bps !== null && bps <= toleranceBps,
      };
    });
}

export function realizedContribution(realized: Amounts): number | null {
  const required: EntryKind[] = [
    "revenue",
    "sale_fee",
    "seller_shipping",
    "product_cost",
    "supplier_shipping",
    "tax",
  ];
  if (required.some((kind) => realized[kind] === undefined)) return null;
  const value = (kind: EntryKind) => realized[kind] ?? 0;
  return value("revenue") - value("refund") - value("sale_fee") - value("seller_shipping") -
    value("product_cost") - value("supplier_shipping") - value("tax");
}
