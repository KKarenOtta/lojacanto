import assert from "node:assert/strict";
import {
  type OperationalLimits,
  type ProductCandidate,
  productRejections,
  type SupplierCandidate,
  supplierRejections,
} from "./eligibility.ts";
import {
  economicsFrom,
  rankProducts,
  type ScoreInput,
  scoreProduct,
  stressedContribution,
} from "./score.ts";

const limits: OperationalLimits = {
  maxWeightGrams: 5_000,
  maxLongestSideCm: 60,
  maxHandlingDays: 2,
  allowFragile: false,
};

const product: ProductCandidate = {
  regulators: [],
  certifiedBy: [],
  thirdPartyBrand: false,
  brandAuthorized: false,
  weightGrams: 800,
  longestSideCm: 30,
  fragile: false,
};

const supplier: SupplierCandidate = {
  cnpjActive: true,
  issuesInvoice: true,
  acceptsMarketplaceLabel: true,
  neutralPackaging: true,
  returnPolicy: true,
  testOrderApproved: true,
  handlingDays: 1,
};

Deno.test("produto dentro dos limites não tem rejeição", () => {
  assert.deepEqual(productRejections(product, limits), []);
});

Deno.test("produto regulado sem certificação, marca não autorizada e fora dos limites é rejeitado", () => {
  assert.deepEqual(
    productRejections({
      ...product,
      regulators: ["anatel", "inmetro"],
      certifiedBy: ["inmetro"],
      thirdPartyBrand: true,
      weightGrams: 5_001,
      longestSideCm: 61,
      fragile: true,
    }, limits),
    ["regulated_without_certification", "unauthorized_brand", "too_heavy", "too_large", "fragile"],
  );
  assert.deepEqual(
    productRejections({ ...product, regulators: ["anatel"], certifiedBy: ["anatel"] }, limits),
    [],
  );
  assert.deepEqual(
    productRejections({ ...product, thirdPartyBrand: true, brandAuthorized: true }, limits),
    [],
  );
});

Deno.test("fornecedor precisa cumprir todos os critérios", () => {
  assert.deepEqual(supplierRejections(supplier, limits), []);
  assert.deepEqual(
    supplierRejections({
      cnpjActive: false,
      issuesInvoice: false,
      acceptsMarketplaceLabel: false,
      neutralPackaging: false,
      returnPolicy: false,
      testOrderApproved: false,
      handlingDays: 3,
    }, limits),
    [
      "supplier_cnpj_inactive",
      "supplier_without_invoice",
      "supplier_rejects_label",
      "supplier_branded_packaging",
      "supplier_without_return_policy",
      "supplier_test_order_pending",
      "supplier_too_slow",
    ],
  );
});

const base: ScoreInput = {
  economics: {
    priceCents: 7_990,
    unitCostCents: 3_000,
    supplierShippingCents: 500,
    sellerShippingCents: 0,
    taxBps: 0,
    fee: { percentageBps: 1_400, fixedCents: 0 },
  },
  stress: { costIncreaseBps: 1_000, feeIncreaseBps: 200, returnRateBps: 500 },
  market: {
    weeksObserved: 4,
    weeksInRanking: 4,
    bestPosition: 3,
    competitors: 10,
    competitorsWithFulfillment: 2,
    officialStoreCompeting: false,
  },
  targetMarginBps: 1_500,
};

Deno.test("contribuição sob estresse aplica custo, comissão e perda por devolução", () => {
  const economics = { ...base.economics, sellerShippingCents: 1_000 };
  const expected = 7_990 - 1_278 - 3_300 - 500 - 1_000 - 125;
  assert.equal(stressedContribution(economics, base.stress), expected);
});

Deno.test("produto viável recebe pontuação composta", () => {
  const score = scoreProduct(base);
  assert.equal(score.viable, true);
  assert.equal(score.stressedContributionCents, 7_990 - 1_278 - 3_300 - 500 - 25);
  assert.equal(
    score.totalPoints,
    score.marginPoints + score.demandPoints + score.competitionPoints + score.returnPoints,
  );
  assert.ok(score.totalPoints > 0 && score.totalPoints <= 10_000);
});

Deno.test("margem abaixo da meta sob estresse zera a pontuação", () => {
  const score = scoreProduct({ ...base, economics: { ...base.economics, unitCostCents: 5_000 } });
  assert.equal(score.viable, false);
  assert.equal(score.totalPoints, 0);
});

Deno.test("demanda persistente e pouca concorrência pontuam mais", () => {
  const weak = scoreProduct({
    ...base,
    market: {
      weeksObserved: 4,
      weeksInRanking: 1,
      bestPosition: null,
      competitors: 80,
      competitorsWithFulfillment: 80,
      officialStoreCompeting: true,
    },
  });
  const strong = scoreProduct(base);
  assert.ok(strong.demandPoints > weak.demandPoints);
  assert.ok(strong.competitionPoints > weak.competitionPoints);
  assert.equal(weak.competitionPoints, 0);
  const none = scoreProduct({
    ...base,
    market: { ...base.market, weeksObserved: 0, competitors: 0, competitorsWithFulfillment: 0 },
  });
  assert.equal(none.demandPoints, 0);
  assert.equal(none.competitionPoints, 2_000);
});

Deno.test("ranking descarta inviáveis e ordena por pontos e contribuição", () => {
  const ranked = rankProducts([
    { id: "a", score: scoreProduct({ ...base, market: { ...base.market, bestPosition: 20 } }) },
    { id: "b", score: scoreProduct(base) },
    {
      id: "c",
      score: scoreProduct({ ...base, economics: { ...base.economics, unitCostCents: 9_000 } }),
    },
  ]);
  assert.deepEqual(ranked.map((candidate) => candidate.id), ["b", "a"]);
});

Deno.test("parâmetros de estresse inválidos são recusados", () => {
  assert.throws(
    () => scoreProduct({ ...base, stress: { ...base.stress, returnRateBps: 10_001 } }),
    RangeError,
  );
});

Deno.test("produto sem custo essencial não gera economia e fica fora da recomendação", () => {
  const complete = {
    priceCents: 7_990,
    unitCostCents: 3_000,
    supplierShippingCents: 500,
    sellerShippingCents: 0,
    taxBps: 0,
    fee: { percentageBps: 1_400, fixedCents: 0 },
  };
  assert.deepEqual(economicsFrom(complete), complete);
  for (
    const key of ["unitCostCents", "supplierShippingCents", "sellerShippingCents", "taxBps", "fee"]
  ) {
    assert.equal(economicsFrom({ ...complete, [key]: null }), null, key);
  }
});
