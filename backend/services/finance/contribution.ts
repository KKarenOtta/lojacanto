import { applyRate, assertBps, assertCents, rateOf } from "./rates.ts";

export interface FeeRule {
  percentageBps: number;
  fixedCents: number;
}

export type FeeSchedule = (unitPriceCents: number) => FeeRule;

export interface LineInput {
  unitPriceCents: number;
  quantity: number;
  saleFeeCents: number | null;
  unitCostCents: number | null;
  supplierShippingCents: number | null;
  sellerShippingCents: number | null;
  refundedCents: number;
  taxBps: number;
}

export type EssentialField = "saleFee" | "unitCost" | "supplierShipping" | "sellerShipping";

export interface KnownContribution {
  status: "known";
  revenueCents: number;
  saleFeeCents: number;
  costCents: number;
  shippingCents: number;
  taxCents: number;
  contributionCents: number;
  marginBps: number | null;
}

export interface UnknownContribution {
  status: "unknown";
  missing: EssentialField[];
}

export type Contribution = KnownContribution | UnknownContribution;

function validate(line: LineInput): void {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new RangeError("quantity must be a positive integer");
  }
  assertCents(line.unitPriceCents, "unitPriceCents");
  assertCents(line.refundedCents, "refundedCents");
  assertBps(line.taxBps, "taxBps");
  for (
    const [name, value] of [
      ["saleFeeCents", line.saleFeeCents],
      ["unitCostCents", line.unitCostCents],
      ["supplierShippingCents", line.supplierShippingCents],
      ["sellerShippingCents", line.sellerShippingCents],
    ] as const
  ) {
    if (value !== null) {
      assertCents(value, name);
      if (value < 0) throw new RangeError(`${name} must not be negative`);
    }
  }
  if (line.unitPriceCents < 0) throw new RangeError("unitPriceCents must not be negative");
  const gross = line.unitPriceCents * line.quantity;
  if (line.refundedCents < 0 || line.refundedCents > gross) {
    throw new RangeError("refundedCents must be between 0 and the line total");
  }
}

export function lineContribution(line: LineInput): Contribution {
  validate(line);
  const missing: EssentialField[] = [];
  if (line.saleFeeCents === null) missing.push("saleFee");
  if (line.unitCostCents === null) missing.push("unitCost");
  if (line.supplierShippingCents === null) missing.push("supplierShipping");
  if (line.sellerShippingCents === null) missing.push("sellerShipping");
  if (missing.length > 0) return { status: "unknown", missing };

  const revenueCents = line.unitPriceCents * line.quantity - line.refundedCents;
  const saleFeeCents = line.saleFeeCents!;
  const costCents = line.unitCostCents! * line.quantity;
  const shippingCents = line.supplierShippingCents! + line.sellerShippingCents!;
  const taxCents = applyRate(revenueCents, line.taxBps);
  const contributionCents = revenueCents - saleFeeCents - costCents - shippingCents - taxCents;
  return {
    status: "known",
    revenueCents,
    saleFeeCents,
    costCents,
    shippingCents,
    taxCents,
    contributionCents,
    marginBps: rateOf(contributionCents, revenueCents),
  };
}

export function estimatedSaleFee(unitPriceCents: number, quantity: number, rule: FeeRule): number {
  assertCents(rule.fixedCents, "fixedCents");
  return applyRate(unitPriceCents * quantity, rule.percentageBps) + rule.fixedCents * quantity;
}

export interface MinimumPriceInput {
  unitCostCents: number;
  supplierShippingCents: number;
  sellerShippingCents: number;
  taxBps: number;
  targetMarginBps: number;
  fees: FeeSchedule;
  maxPriceCents?: number;
}

export function unitContribution(priceCents: number, input: MinimumPriceInput): number {
  return priceCents - estimatedSaleFee(priceCents, 1, input.fees(priceCents)) -
    input.unitCostCents - input.supplierShippingCents - input.sellerShippingCents -
    applyRate(priceCents, input.taxBps);
}

export function minimumPrice(input: MinimumPriceInput): number | null {
  assertBps(input.targetMarginBps, "targetMarginBps");
  const meets = (price: number) =>
    unitContribution(price, input) >= applyRate(price, input.targetMarginBps);
  let high = input.maxPriceCents ?? 100_000_000;
  if (!meets(high)) return null;
  let low = 0;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (meets(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}
