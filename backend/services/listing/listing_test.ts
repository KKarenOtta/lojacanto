import assert from "node:assert/strict";
import { buildDescription, type DescriptionInput, descriptionRejections } from "./description.ts";
import { endingInNinety, listingPrice, type ListingPriceInput, meetsTarget } from "./pricing.ts";
import { buildTitle, normalizeTitlePart, titleRejections } from "./title.ts";

Deno.test("title keeps product first and adds parts in order while they fit", () => {
  const result = buildTitle({
    product: "Organizador de Gaveta",
    brand: "Plasútil",
    model: "Modular",
    features: ["Kit 6 Peças", "Transparente", "Cozinha e Escritório"],
  }, 60);
  assert.equal(result.title, "Organizador de Gaveta Plasútil Modular Kit 6 Peças");
  assert.deepEqual(result.dropped, ["Transparente", "Cozinha e Escritório"]);
  assert.ok(result.title.length <= 60);
});

Deno.test("title skips a later part that does not fit and keeps trying shorter ones", () => {
  const result = buildTitle({
    product: "Porta Temperos",
    features: ["Giratório com 12 Potes de Vidro e Tampas", "Inox"],
  }, 30);
  assert.equal(result.title, "Porta Temperos Inox");
  assert.deepEqual(result.dropped, ["Giratório com 12 Potes de Vidro e Tampas"]);
});

Deno.test("title removes symbols, keeps decimal separators and collapses spaces", () => {
  assert.equal(
    normalizeTitlePart("  Garrafa   Térmica (1.5 L) - Preta!! "),
    "Garrafa Térmica 1,5 L Preta",
  );
  assert.equal(normalizeTitlePart("Pote 2,5L"), "Pote 2,5L");
});

Deno.test("title ignores a part already contained in the title", () => {
  const result = buildTitle({ product: "Lixeira Inox 5 Litros", features: ["inox", "Pedal"] }, 60);
  assert.equal(result.title, "Lixeira Inox 5 Litros Pedal");
});

Deno.test("title rejects condition and stock terms regardless of accents and case", () => {
  assert.deepEqual(titleRejections({ product: "Escorredor NOVO", features: [] }), [
    "condition_term",
  ]);
  assert.deepEqual(
    titleRejections({ product: "Escorredor", features: ["Últimas Unidades"] }),
    ["stock_term"],
  );
  assert.deepEqual(titleRejections({ product: "Novelo de Lã", features: [] }), []);
  assert.throws(() => buildTitle({ product: "Pote usado", features: [] }, 60), /condition_term/);
});

Deno.test("title requires a product that fits and a positive limit", () => {
  assert.throws(() => buildTitle({ product: "  ", features: [] }, 60), /product is required/);
  assert.throws(() => buildTitle({ product: "Organizador", features: [] }, 5), /longer than/);
  assert.throws(() => buildTitle({ product: "Pote", features: [] }, 0), /positive integer/);
});

const description: DescriptionInput = {
  summary: "Organize talheres e utensílios sem perder espaço na gaveta.",
  highlights: ["Módulos encaixáveis", "  Plástico resistente  "],
  includedItems: ["6 módulos"],
  usage: [],
  care: ["Lavar com água e sabão neutro"],
};

Deno.test("description is plain text with sections, line breaks and no empty sections", () => {
  const text = buildDescription(description);
  assert.equal(
    text,
    [
      "Organize talheres e utensílios sem perder espaço na gaveta.",
      "",
      "DESTAQUES",
      "- Módulos encaixáveis",
      "- Plástico resistente",
      "",
      "O QUE VEM NA EMBALAGEM",
      "- 6 módulos",
      "",
      "CUIDADOS",
      "- Lavar com água e sabão neutro",
      "",
      "Ficou com alguma dúvida? Pergunte no anúncio que respondemos rapidinho.",
    ].join("\n"),
  );
  assert.ok(!/[<>]/.test(text));
});

Deno.test("description rejects markup, emoji and contact data", () => {
  assert.deepEqual(descriptionRejections({ ...description, summary: "Ótimo <b>preço</b>" }), [
    "markup",
  ]);
  assert.deepEqual(descriptionRejections({ ...description, highlights: ["Lindo ✨"] }), ["emoji"]);
  for (
    const contact of [
      "Fale em contato@cantoutil.com",
      "Veja www.exemplo.com",
      "Loja cantoutil.com.br",
      "Ligue (11) 91234-5678",
      "Chama no WhatsApp",
    ]
  ) {
    assert.deepEqual(
      descriptionRejections({ ...description, care: [contact] }),
      ["contact_data"],
      contact,
    );
  }
  assert.deepEqual(
    descriptionRejections({ ...description, highlights: ["Capacidade 10000 mAh"] }),
    [],
  );
  assert.deepEqual(descriptionRejections({ ...description, summary: " " }), ["empty_summary"]);
  assert.throws(() => buildDescription({ ...description, summary: "" }), /empty_summary/);
});

const flatFees = () => ({ percentageBps: 1400, fixedCents: 0 });

const priceInput: ListingPriceInput = {
  unitCostCents: 1500,
  supplierShippingCents: 0,
  taxBps: 0,
  targetMarginBps: 2000,
  fees: flatFees,
  freeShippingThresholdCents: 7900,
  sellerShippingBelowCents: 0,
  sellerShippingAboveCents: 2000,
};

Deno.test("ending in ninety rounds up to the next price ending in ,90", () => {
  assert.equal(endingInNinety(4731), 4790);
  assert.equal(endingInNinety(4790), 4790);
  assert.equal(endingInNinety(4795), 4890);
  assert.equal(endingInNinety(0), 90);
});

Deno.test("price below the free shipping threshold uses the buyer-paid shipping zone", () => {
  const price = listingPrice(priceInput)!;
  assert.equal(price.freeShipping, false);
  assert.equal(price.suggestedCents, endingInNinety(price.minimumCents));
  assert.ok(meetsTarget(price.minimumCents, priceInput));
  assert.ok(!meetsTarget(price.minimumCents - 1, priceInput));
  assert.ok(meetsTarget(price.suggestedCents, priceInput));
});

Deno.test("price that cannot meet the target below the threshold moves above it with seller shipping", () => {
  const input = { ...priceInput, unitCostCents: 5300 };
  const price = listingPrice(input)!;
  assert.ok(price.minimumCents >= input.freeShippingThresholdCents);
  assert.equal(price.freeShipping, true);
  assert.ok(meetsTarget(price.minimumCents, input));
  assert.ok(meetsTarget(price.suggestedCents, input));
  for (let cents = 0; cents < price.minimumCents; cents += 7) {
    assert.ok(!meetsTarget(cents, input), `${cents} should not meet the target`);
  }
});

Deno.test("rounding that crosses the threshold is recomputed with seller shipping", () => {
  const input = { ...priceInput, unitCostCents: 5210 };
  const price = listingPrice(input)!;
  assert.ok(price.minimumCents < input.freeShippingThresholdCents);
  assert.ok(price.suggestedCents >= input.freeShippingThresholdCents);
  assert.ok(meetsTarget(price.suggestedCents, input));
  assert.equal(price.suggestedCents % 100, 90);
});

Deno.test("price is null when the ceiling prevents the target margin", () => {
  assert.equal(listingPrice({ ...priceInput, unitCostCents: 5300, maxPriceCents: 7800 }), null);
  assert.equal(listingPrice({ ...priceInput, targetMarginBps: 9000 }), null);
});

Deno.test("suggestion falls back to the minimum when ,90 would exceed the ceiling", () => {
  const minimum = listingPrice(priceInput)!.minimumCents;
  const price = listingPrice({ ...priceInput, maxPriceCents: minimum })!;
  assert.equal(price.suggestedCents, minimum);
});

Deno.test("price rejects negative or fractional costs", () => {
  assert.throws(() => listingPrice({ ...priceInput, unitCostCents: -1 }), /must not be negative/);
  assert.throws(
    () => listingPrice({ ...priceInput, sellerShippingAboveCents: 1.5 }),
    /integer cents/,
  );
});
