import { type FeeSchedule, minimumPrice, unitContribution } from "../finance/contribution.ts";
import { applyRate, assertCents } from "../finance/rates.ts";

export interface ListingPriceInput {
  unitCostCents: number;
  supplierShippingCents: number;
  taxBps: number;
  targetMarginBps: number;
  fees: FeeSchedule;
  freeShippingThresholdCents: number;
  sellerShippingBelowCents: number;
  sellerShippingAboveCents: number;
  maxPriceCents?: number;
}

export interface ListingPrice {
  minimumCents: number;
  suggestedCents: number;
  freeShipping: boolean;
}

const DEFAULT_MAX_PRICE_CENTS = 100_000_000;

function zoneInput(input: ListingPriceInput, priceCents: number) {
  const freeShipping = priceCents >= input.freeShippingThresholdCents;
  return {
    unitCostCents: input.unitCostCents,
    supplierShippingCents: input.supplierShippingCents,
    sellerShippingCents: freeShipping
      ? input.sellerShippingAboveCents
      : input.sellerShippingBelowCents,
    taxBps: input.taxBps,
    targetMarginBps: input.targetMarginBps,
    fees: input.fees,
  };
}

export function meetsTarget(priceCents: number, input: ListingPriceInput): boolean {
  return unitContribution(priceCents, zoneInput(input, priceCents)) >=
    applyRate(priceCents, input.targetMarginBps);
}

export function endingInNinety(priceCents: number): number {
  assertCents(priceCents, "priceCents");
  if (priceCents < 0) throw new RangeError("priceCents must not be negative");
  const candidate = Math.floor(priceCents / 100) * 100 + 90;
  return candidate >= priceCents ? candidate : candidate + 100;
}

export function listingPrice(input: ListingPriceInput): ListingPrice | null {
  for (
    const [name, value] of [
      ["unitCostCents", input.unitCostCents],
      ["supplierShippingCents", input.supplierShippingCents],
      ["freeShippingThresholdCents", input.freeShippingThresholdCents],
      ["sellerShippingBelowCents", input.sellerShippingBelowCents],
      ["sellerShippingAboveCents", input.sellerShippingAboveCents],
    ] as const
  ) {
    assertCents(value, name);
    if (value < 0) throw new RangeError(`${name} must not be negative`);
  }
  const ceiling = input.maxPriceCents ?? DEFAULT_MAX_PRICE_CENTS;
  const threshold = input.freeShippingThresholdCents;

  const below = threshold > 0
    ? minimumPrice({ ...zoneInput(input, 0), maxPriceCents: Math.min(threshold - 1, ceiling) })
    : null;
  let minimumCents: number;
  if (below !== null) {
    minimumCents = below;
  } else {
    if (ceiling < threshold) return null;
    const above = minimumPrice({ ...zoneInput(input, threshold), maxPriceCents: ceiling });
    if (above === null) return null;
    minimumCents = Math.max(above, threshold);
  }

  let suggestedCents = endingInNinety(minimumCents);
  if (!meetsTarget(suggestedCents, input)) {
    const above = minimumPrice({ ...zoneInput(input, threshold), maxPriceCents: ceiling });
    if (above === null) return null;
    suggestedCents = endingInNinety(Math.max(above, threshold));
  }
  if (suggestedCents > ceiling) suggestedCents = minimumCents;
  return { minimumCents, suggestedCents, freeShipping: suggestedCents >= threshold };
}
