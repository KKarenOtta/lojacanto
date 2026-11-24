import assert from "node:assert/strict";
import { ContractError } from "../../shared/errors.ts";
import { listingPricesPath, mapListingPrices } from "./listing_prices.ts";

const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/listing_prices.json", import.meta.url)),
);

Deno.test("mapeia o exemplo oficial de listing_prices", () => {
  assert.deepEqual(mapListingPrices(fixture, "gold_special"), {
    listingTypeId: "gold_special",
    currency: "ARS",
    saleFeeCents: 88770,
    percentageBps: 1300,
    fixedFeeCents: 20000,
  });
});

Deno.test("tipo de anúncio ausente ou campo inválido gera ContractError com caminho", () => {
  assert.throws(() => mapListingPrices(fixture, "gold_pro"), ContractError);
  const broken = structuredClone(fixture);
  broken[0].sale_fee_details.percentage_fee = "treze";
  assert.throws(
    () => mapListingPrices(broken, "gold_special"),
    (error: unknown) =>
      error instanceof ContractError &&
      error.path === "listing_prices[0].sale_fee_details.percentage_fee",
  );
  assert.throws(() => mapListingPrices({}, "gold_special"), ContractError);
  assert.throws(
    () => mapListingPrices([{ ...fixture[0], currency_id: "R$" }], "gold_special"),
    ContractError,
  );
});

Deno.test("consulta inclui logística e modo de envio exigidos para a tarifa fixa", () => {
  const path = listingPricesPath({
    categoryId: "MLB1234",
    listingTypeId: "gold_special",
    priceCents: 7990,
    logisticType: "xd_drop_off",
  });
  const url = new URL(`https://api.test${path}`);
  assert.equal(url.pathname, "/sites/MLB/listing_prices");
  assert.equal(url.searchParams.get("price"), "79.90");
  assert.equal(url.searchParams.get("currency_id"), "BRL");
  assert.equal(url.searchParams.get("logistic_type"), "xd_drop_off");
  assert.equal(url.searchParams.get("shipping_mode"), "me2");
  assert.equal(
    new URL(`https://api.test${
      listingPricesPath({
        categoryId: "MLB1",
        listingTypeId: "gold_pro",
        priceCents: 100,
        logisticType: "default",
      })
    }`).searchParams.get("shipping_mode"),
    "me1",
  );
});

Deno.test("consulta recusa parâmetros fora do padrão", () => {
  const base = {
    categoryId: "MLB1",
    listingTypeId: "gold_special",
    priceCents: 100,
    logisticType: "drop_off" as const,
  };
  assert.throws(() => listingPricesPath({ ...base, categoryId: "MLA1" }), RangeError);
  assert.throws(() => listingPricesPath({ ...base, listingTypeId: "x&y=1" }), RangeError);
  assert.throws(() => listingPricesPath({ ...base, priceCents: 0 }), RangeError);
});
