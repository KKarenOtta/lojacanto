import assert from "node:assert/strict";
import { ContractError } from "../../shared/errors.ts";
import {
  mapSellerShippingCost,
  sellerShippingPath,
  type SellerShippingQuery,
} from "./shipping_costs.ts";

const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/shipping_options_free.json", import.meta.url)),
);

const query: SellerShippingQuery = {
  userId: 478055419,
  dimensions: "9x17x22,462",
  priceCents: 7990,
  listingTypeId: "gold_special",
  logisticType: "xd_drop_off",
  freeShipping: true,
};

Deno.test("mapeia o custo de envio do vendedor do exemplo oficial", () => {
  assert.deepEqual(mapSellerShippingCost(fixture), {
    currency: "ARS",
    costCents: 810649,
    billableWeightGrams: 5828,
  });
});

Deno.test("resposta fora do contrato gera ContractError", () => {
  assert.throws(() => mapSellerShippingCost({}), ContractError);
  assert.throws(() => mapSellerShippingCost(null), ContractError);
  const broken = structuredClone(fixture);
  broken.coverage.all_country.list_cost = -1;
  assert.throws(() => mapSellerShippingCost(broken), ContractError);
  broken.coverage.all_country.list_cost = 1;
  broken.coverage.all_country.billable_weight = 1.5;
  assert.throws(() => mapSellerShippingCost(broken), ContractError);
  broken.coverage.all_country.billable_weight = 1;
  broken.coverage.all_country.currency_id = "R$";
  assert.throws(() => mapSellerShippingCost(broken), ContractError);
});

Deno.test("consulta envia logística, frete grátis e dimensões ou anúncio", () => {
  const url = new URL(`https://api.test${sellerShippingPath(query)}`);
  assert.equal(url.pathname, "/users/478055419/shipping_options/free");
  assert.equal(url.searchParams.get("item_price"), "79.90");
  assert.equal(url.searchParams.get("dimensions"), "9x17x22,462");
  assert.equal(url.searchParams.get("logistic_type"), "xd_drop_off");
  assert.equal(url.searchParams.get("free_shipping"), "true");
  const byItem = new URL(
    `https://api.test${sellerShippingPath({ ...query, dimensions: undefined, itemId: "MLB123" })}`,
  );
  assert.equal(byItem.searchParams.get("item_id"), "MLB123");
});

Deno.test("consulta recusa parâmetros inválidos", () => {
  assert.throws(() => sellerShippingPath({ ...query, dimensions: undefined }), RangeError);
  assert.throws(() => sellerShippingPath({ ...query, dimensions: "9x17" }), RangeError);
  assert.throws(
    () => sellerShippingPath({ ...query, dimensions: undefined, itemId: "MLA1" }),
    RangeError,
  );
  assert.throws(() => sellerShippingPath({ ...query, userId: 0 }), RangeError);
  assert.throws(() => sellerShippingPath({ ...query, priceCents: 0 }), RangeError);
  assert.throws(() => sellerShippingPath({ ...query, listingTypeId: "a&b" }), RangeError);
});
