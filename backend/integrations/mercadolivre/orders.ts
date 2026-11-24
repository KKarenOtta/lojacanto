import { ContractError } from "../../shared/errors.ts";
import { ORDER_STATUSES, type OrderStatus } from "../../shared/marketplace.ts";
import { toCents } from "../../shared/money.ts";

export interface OrderItemSnapshot {
  itemId: string;
  title: string;
  variationId: string | null;
  quantity: number;
  unitPriceCents: number;
  saleFeeCents: number | null;
  listingTypeId: string | null;
}

export interface OrderSnapshot {
  externalId: string;
  sellerId: string;
  packId: string | null;
  shippingId: string | null;
  status: OrderStatus;
  statusDetail: string | null;
  currency: string;
  totalCents: number;
  paidCents: number;
  createdAt: string;
  closedAt: string | null;
  lastUpdated: string;
  isTest: boolean;
  items: OrderItemSnapshot[];
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError(path, "expected an object");
  }
  return value as Json;
}

function id(value: unknown, path: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[A-Z]{0,4}\d{1,20}$/.test(value)) return value;
  throw new ContractError(path, "expected an identifier");
}

function optionalId(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : id(value, path);
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractError(path, "expected text");
  }
  return value;
}

function optionalText(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : text(value, path);
}

function timestamp(value: unknown, path: string): string {
  const raw = text(value, path);
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) throw new ContractError(path, "expected a date");
  return new Date(parsed).toISOString();
}

function mapItem(raw: unknown, index: number): OrderItemSnapshot {
  const path = `order.order_items[${index}]`;
  const entry = object(raw, path);
  const item = object(entry.item, `${path}.item`);
  const quantity = entry.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
    throw new ContractError(`${path}.quantity`, "expected a positive integer");
  }
  return {
    itemId: id(item.id, `${path}.item.id`),
    title: text(item.title, `${path}.item.title`),
    variationId: optionalId(item.variation_id, `${path}.item.variation_id`),
    quantity,
    unitPriceCents: toCents(entry.unit_price, `${path}.unit_price`),
    saleFeeCents: entry.sale_fee === null || entry.sale_fee === undefined
      ? null
      : toCents(entry.sale_fee, `${path}.sale_fee`),
    listingTypeId: optionalText(entry.listing_type_id, `${path}.listing_type_id`),
  };
}

export function mapOrder(raw: unknown): OrderSnapshot {
  const order = object(raw, "order");
  const status = order.status;
  if (typeof status !== "string" || !(ORDER_STATUSES as readonly string[]).includes(status)) {
    throw new ContractError("order.status", `unknown status "${String(status)}"`);
  }
  const items = order.order_items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ContractError("order.order_items", "expected at least one item");
  }
  const currency = text(order.currency_id, "order.currency_id");
  if (!/^[A-Z]{3}$/.test(currency)) throw new ContractError("order.currency_id", "invalid");
  const shipping = order.shipping === null || order.shipping === undefined
    ? null
    : object(order.shipping, "order.shipping");
  const tags = Array.isArray(order.tags) ? order.tags : [];
  return {
    externalId: id(order.id, "order.id"),
    sellerId: id(object(order.seller, "order.seller").id, "order.seller.id"),
    packId: optionalId(order.pack_id, "order.pack_id"),
    shippingId: shipping ? optionalId(shipping.id, "order.shipping.id") : null,
    status: status as OrderStatus,
    statusDetail: typeof order.status_detail === "string" ? order.status_detail : null,
    currency,
    totalCents: toCents(order.total_amount, "order.total_amount"),
    paidCents: order.paid_amount === null || order.paid_amount === undefined
      ? 0
      : toCents(order.paid_amount, "order.paid_amount"),
    createdAt: timestamp(order.date_created, "order.date_created"),
    closedAt: order.date_closed ? timestamp(order.date_closed, "order.date_closed") : null,
    lastUpdated: timestamp(order.last_updated, "order.last_updated"),
    isTest: tags.includes("test_order"),
    items: items.map(mapItem),
  };
}
