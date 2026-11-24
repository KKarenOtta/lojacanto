import { ContractError } from "../../shared/errors.ts";
import { toCents } from "../../shared/money.ts";
import type { LogisticType } from "./listing_prices.ts";

export interface SellerShippingQuery {
  userId: number;
  itemId?: string;
  dimensions?: string;
  priceCents: number;
  listingTypeId: string;
  logisticType: LogisticType;
  freeShipping: boolean;
}

export interface SellerShippingCost {
  currency: string;
  costCents: number;
  billableWeightGrams: number;
}

export function sellerShippingPath(query: SellerShippingQuery): string {
  if (!Number.isSafeInteger(query.userId) || query.userId <= 0) {
    throw new RangeError("invalid user id");
  }
  if (!Number.isSafeInteger(query.priceCents) || query.priceCents <= 0) {
    throw new RangeError("priceCents must be a positive integer");
  }
  if (!/^[a-z_]+$/.test(query.listingTypeId)) throw new RangeError("invalid listing_type_id");
  const params = new URLSearchParams({
    item_price: (query.priceCents / 100).toFixed(2),
    listing_type_id: query.listingTypeId,
    mode: "me2",
    condition: "new",
    logistic_type: query.logisticType,
    free_shipping: String(query.freeShipping),
    verbose: "true",
  });
  if (query.itemId !== undefined) {
    if (!/^MLB\d+$/.test(query.itemId)) throw new RangeError("invalid item_id");
    params.set("item_id", query.itemId);
  } else if (query.dimensions !== undefined) {
    if (!/^\d+x\d+x\d+,\d+$/.test(query.dimensions)) throw new RangeError("invalid dimensions");
    params.set("dimensions", query.dimensions);
  } else {
    throw new RangeError("item_id or dimensions is required");
  }
  return `/users/${query.userId}/shipping_options/free?${params}`;
}

export function mapSellerShippingCost(raw: unknown): SellerShippingCost {
  const coverage = (raw as { coverage?: { all_country?: Record<string, unknown> } } | null)
    ?.coverage?.all_country;
  if (!coverage || typeof coverage !== "object") {
    throw new ContractError("coverage.all_country", "expected an object");
  }
  const currency = coverage.currency_id;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new ContractError("coverage.all_country.currency_id", "invalid currency");
  }
  const weight = coverage.billable_weight;
  if (!Number.isSafeInteger(weight) || (weight as number) < 0) {
    throw new ContractError("coverage.all_country.billable_weight", "invalid weight");
  }
  const costCents = toCents(coverage.list_cost, "coverage.all_country.list_cost");
  if (costCents < 0) throw new ContractError("coverage.all_country.list_cost", "negative cost");
  return { currency, costCents, billableWeightGrams: weight as number };
}
