import { assertCents, BPS_SCALE, rateOf } from "./rates.ts";
import type { Amounts } from "./reconciliation.ts";

export interface IncomeStatement {
  grossRevenueCents: number;
  refundsCents: number;
  salesTaxCents: number;
  netRevenueCents: number;
  variableCostsCents: number;
  contributionCents: number;
  contributionMarginBps: number | null;
  fixedExpensesCents: number;
  operatingResultCents: number;
  breakEvenRevenueCents: number | null;
}

function amount(values: Amounts, kind: keyof Amounts): number {
  const value = values[kind] ?? 0;
  assertCents(value, kind);
  return value;
}

export function breakEvenRevenue(
  fixedCents: number,
  contributionMarginBps: number | null,
): number | null {
  assertCents(fixedCents, "fixedCents");
  if (contributionMarginBps === null || contributionMarginBps <= 0) return null;
  const numerator = BigInt(fixedCents) * BigInt(BPS_SCALE);
  const denominator = BigInt(contributionMarginBps);
  return Number((numerator + denominator - 1n) / denominator);
}

export function incomeStatement(period: Amounts, fixedExpensesCents: number): IncomeStatement {
  assertCents(fixedExpensesCents, "fixedExpensesCents");
  const grossRevenueCents = amount(period, "revenue");
  const refundsCents = amount(period, "refund");
  const salesTaxCents = amount(period, "tax");
  const netRevenueCents = grossRevenueCents - refundsCents - salesTaxCents;
  const variableCostsCents = amount(period, "product_cost") + amount(period, "supplier_shipping") +
    amount(period, "sale_fee") + amount(period, "seller_shipping");
  const contributionCents = netRevenueCents - variableCostsCents;
  const contributionMarginBps = rateOf(contributionCents, netRevenueCents);
  return {
    grossRevenueCents,
    refundsCents,
    salesTaxCents,
    netRevenueCents,
    variableCostsCents,
    contributionCents,
    contributionMarginBps,
    fixedExpensesCents,
    operatingResultCents: contributionCents - fixedExpensesCents,
    breakEvenRevenueCents: breakEvenRevenue(fixedExpensesCents, contributionMarginBps),
  };
}
