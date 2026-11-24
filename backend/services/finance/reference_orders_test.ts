import assert from "node:assert/strict";
import { lineContribution } from "./contribution.ts";

interface ReferenceOrder {
  id: number;
  description: string;
  unit_price_cents: number;
  quantity: number;
  sale_fee_cents: number | null;
  unit_cost_cents: number | null;
  supplier_shipping_cents: number | null;
  seller_shipping_cents: number | null;
  refunded_cents: number;
  tax_bps: number;
  expected: unknown;
}

const orders: ReferenceOrder[] = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/reference_orders.json", import.meta.url)),
);

Deno.test("planilha de referência: 30 pedidos sem divergência", () => {
  assert.equal(orders.length, 30);
  for (const order of orders) {
    const result = lineContribution({
      unitPriceCents: order.unit_price_cents,
      quantity: order.quantity,
      saleFeeCents: order.sale_fee_cents,
      unitCostCents: order.unit_cost_cents,
      supplierShippingCents: order.supplier_shipping_cents,
      sellerShippingCents: order.seller_shipping_cents,
      refundedCents: order.refunded_cents,
      taxBps: order.tax_bps,
    });
    assert.deepEqual(result, order.expected, `pedido ${order.id}: ${order.description}`);
  }
});
