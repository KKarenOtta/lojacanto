import { ContractError } from "../../shared/errors.ts";
import { toBasisPoints, toCents } from "../../shared/money.ts";

export const LOGISTIC_TYPES = [
  "drop_off",
  "cross_docking",
  "xd_drop_off",
  "self_service",
  "turbo",
  "fulfillment",
  "default",
  "custom",
  "not_specified",
] as const;

export type LogisticType = typeof LOGISTIC_TYPES[number];

const SHIPPING_MODE: Record<LogisticType, string> = {
  drop_off: "me2",
  cross_docking: "me2",
  xd_drop_off: "me2",
  self_service: "me2",
  turbo: "me2",
  fulfillment: "me2",
  default: "me1",
  custom: "custom",
  not_specified: "not_specified",
};

export interface ListingPriceQuery {
  categoryId: string;
  listingTypeId: string;
  priceCents: number;
  logisticType: LogisticType;
}

export interface ListingPrice {
  listingTypeId: string;
  currency: string;
  saleFeeCents: number;
  percentageBps: number;
  fixedFeeCents: number;
}

export function listingPricesPath(query: ListingPriceQuery): string {
  if (!/^MLB\d+$/.test(query.categoryId)) throw new RangeError("invalid category_id");
  if (!/^[a-z_]+$/.test(query.listingTypeId)) throw new RangeError("invalid listing_type_id");
  if (!Number.isSafeInteger(query.priceCents) || query.priceCents <= 0) {
    throw new RangeError("priceCents must be a positive integer");
  }
  const params = new URLSearchParams({
    price: (query.priceCents / 100).toFixed(2),
    currency_id: "BRL",
    category_id: query.categoryId,
    listing_type_id: query.listingTypeId,
    logistic_type: query.logisticType,
    shipping_mode: SHIPPING_MODE[query.logisticType],
  });
  return `/sites/MLB/listing_prices?${params}`;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

export function mapListingPrices(raw: unknown, listingTypeId: string): ListingPrice {
  if (!Array.isArray(raw)) throw new ContractError("listing_prices", "expected an array");
  const index = raw.findIndex((entry) =>
    record(entry, "listing_prices[]").listing_type_id === listingTypeId
  );
  if (index < 0) {
    throw new ContractError("listing_prices", `listing type ${listingTypeId} not returned`);
  }
  const path = `listing_prices[${index}]`;
  const entry = record(raw[index], path);
  const details = record(entry.sale_fee_details, `${path}.sale_fee_details`);
  const currency = entry.currency_id;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new ContractError(`${path}.currency_id`, "invalid currency");
  }
  return {
    listingTypeId,
    currency,
    saleFeeCents: toCents(entry.sale_fee_amount, `${path}.sale_fee_amount`),
    percentageBps: toBasisPoints(details.percentage_fee, `${path}.sale_fee_details.percentage_fee`),
    fixedFeeCents: toCents(details.fixed_fee, `${path}.sale_fee_details.fixed_fee`),
  };
}
