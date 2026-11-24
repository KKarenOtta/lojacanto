import assert from "node:assert/strict";
import { ContractError } from "../../shared/errors.ts";
import { mapOrder } from "./orders.ts";

const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/order_paid.json", import.meta.url)),
);

function withChanges(changes: Record<string, unknown>) {
  return { ...structuredClone(fixture), ...changes };
}

Deno.test("mapOrder converte o pedido documentado sem dados pessoais", () => {
  assert.deepEqual(mapOrder(fixture), {
    externalId: "2000003508897196",
    sellerId: "478055419",
    packId: "2000003508553677",
    shippingId: "41297142475",
    status: "paid",
    statusDetail: null,
    currency: "BRL",
    totalCents: 5000,
    paidCents: 5000,
    createdAt: "2022-04-08T21:01:30.000Z",
    closedAt: "2022-04-08T21:01:33.000Z",
    lastUpdated: "2022-04-08T21:03:32.000Z",
    isTest: true,
    items: [{
      itemId: "MLB2608564035",
      title: "Camiseta Basica",
      variationId: "174390848694",
      quantity: 1,
      unitPriceCents: 5000,
      saleFeeCents: 1200,
      listingTypeId: "gold_special",
    }],
  });
});

Deno.test("mapOrder normaliza datas para UTC e aceita campos opcionais ausentes", () => {
  const order = withChanges({
    pack_id: null,
    shipping: null,
    date_closed: null,
    paid_amount: null,
    tags: undefined,
    status_detail: "waiting_payment",
  });
  const mapped = mapOrder(order);
  assert.equal(mapped.packId, null);
  assert.equal(mapped.shippingId, null);
  assert.equal(mapped.closedAt, null);
  assert.equal(mapped.paidCents, 0);
  assert.equal(mapped.isTest, false);
  assert.equal(mapped.statusDetail, "waiting_payment");
});

Deno.test("mapOrder aceita item sem tarifa, variação ou tipo de anúncio", () => {
  const order = withChanges({});
  const entry = order.order_items[0];
  entry.sale_fee = null;
  entry.listing_type_id = null;
  entry.item.variation_id = null;
  const [item] = mapOrder(order).items;
  assert.equal(item!.saleFeeCents, null);
  assert.equal(item!.listingTypeId, null);
  assert.equal(item!.variationId, null);
});

Deno.test("mapOrder rejeita violações de contrato indicando o campo", () => {
  const cases: Array<[unknown, string]> = [
    [null, "order"],
    [withChanges({ status: "shipped" }), "order.status"],
    [withChanges({ order_items: [] }), "order.order_items"],
    [withChanges({ currency_id: "real" }), "order.currency_id"],
    [withChanges({ id: 1.5 }), "order.id"],
    [withChanges({ seller: null }), "order.seller"],
    [withChanges({ total_amount: "abc" }), "order.total_amount"],
    [withChanges({ last_updated: "ontem" }), "order.last_updated"],
    [withChanges({ date_created: "" }), "order.date_created"],
    [withChanges({ shipping: [] }), "order.shipping"],
  ];
  for (const [input, path] of cases) {
    assert.throws(() => mapOrder(input), (error: unknown) => {
      assert.ok(error instanceof ContractError);
      assert.equal(error.path, path);
      return true;
    });
  }
});

Deno.test("mapOrder rejeita item inválido", () => {
  const badQuantity = withChanges({});
  badQuantity.order_items[0].quantity = 0;
  assert.throws(() => mapOrder(badQuantity), ContractError);

  const missingTitle = withChanges({});
  missingTitle.order_items[0].item.title = "";
  assert.throws(() => mapOrder(missingTitle), ContractError);

  const badItem = withChanges({ order_items: ["x"] });
  assert.throws(() => mapOrder(badItem), ContractError);

  const badListing = withChanges({});
  badListing.order_items[0].listing_type_id = 7;
  assert.throws(() => mapOrder(badListing), ContractError);
});
