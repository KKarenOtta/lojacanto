import assert from "node:assert/strict";
import type { OperationalLimits, ProductCandidate, SupplierCandidate } from "./eligibility.ts";
import { type Kit, type KitItem, kitRejections, kitUnitCostCents } from "./kits.ts";
import { type Candidate, selectionRows, weeklySelection, weekOf } from "./recommendations.ts";
import type { ScoreInput } from "./score.ts";
import { BACK_TO_SCHOOL, seasonPhase } from "./seasonal.ts";

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
  handlingDays: 0,
};

const scoring: ScoreInput = {
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
    rating: null,
  },
  targetMarginBps: 1_500,
};

const item = (sku: string, overrides: Partial<KitItem> = {}): KitItem => ({
  sku,
  quantity: 1,
  unitCostCents: 500,
  supplierId: "silkdrop",
  regulators: [],
  certifiedBy: [],
  originalPackaging: true,
  inStock: true,
  ...overrides,
});

const candidate = (key: string, overrides: Partial<Candidate> = {}): Candidate => ({
  key,
  title: `Produto ${key}`,
  supplierId: "silkdrop",
  product,
  supplier,
  scoring,
  ...overrides,
});

Deno.test("volta às aulas: temporada, antecedência e fora de época no horário de São Paulo", () => {
  assert.equal(seasonPhase(BACK_TO_SCHOOL, new Date("2026-11-25T12:00:00Z")), "in_season");
  assert.equal(seasonPhase(BACK_TO_SCHOOL, new Date("2027-02-28T12:00:00Z")), "in_season");
  assert.equal(seasonPhase(BACK_TO_SCHOOL, new Date("2026-03-01T02:00:00Z")), "in_season");
  assert.equal(seasonPhase(BACK_TO_SCHOOL, new Date("2026-10-01T12:00:00Z")), "lead");
  assert.equal(seasonPhase(BACK_TO_SCHOOL, new Date("2026-06-15T12:00:00Z")), "off_season");
  assert.equal(
    seasonPhase(
      { name: "inverno", startMonth: 5, endMonth: 7, leadWeeks: 0 },
      new Date("2026-06-01T12:00:00Z"),
    ),
    "in_season",
  );
  assert.throws(() => seasonPhase({ ...BACK_TO_SCHOOL, startMonth: 13 }, new Date()), RangeError);
  assert.throws(() => seasonPhase({ ...BACK_TO_SCHOOL, leadWeeks: 27 }, new Date()), RangeError);
  assert.throws(() => seasonPhase(BACK_TO_SCHOOL, new Date("x")), RangeError);
});

Deno.test("kit segue a regra de cada item, estoque, fornecedor único e montagem", () => {
  const certified: Kit = {
    items: [
      item("lapis", { quantity: 2, regulators: ["inmetro"], certifiedBy: ["inmetro"] }),
      item("caderno", { unitCostCents: 1_200 }),
    ],
    assembledBySupplier: true,
    assemblerMeetsAnnexB: true,
  };
  assert.deepEqual(kitRejections(certified), []);
  assert.equal(kitUnitCostCents(certified), 2_200);

  assert.deepEqual(
    kitRejections({
      items: [
        item("cola", { regulators: ["inmetro"], originalPackaging: false }),
        item("cola"),
        item("regua", { supplierId: "outro", inStock: false, quantity: 0 }),
      ],
      assembledBySupplier: true,
      assemblerMeetsAnnexB: false,
    }),
    [
      "item_not_certified",
      "item_without_original_packaging",
      "duplicate_sku",
      "invalid_quantity",
      "item_out_of_stock",
      "mixed_suppliers",
      "assembler_not_compliant",
    ],
  );
  assert.deepEqual(
    kitRejections({
      items: [item("caderno")],
      assembledBySupplier: false,
      assemblerMeetsAnnexB: false,
    }),
    ["not_assembled_by_supplier"],
  );
  assert.deepEqual(kitRejections({ ...certified, items: [] }), ["empty_kit"]);
  assert.throws(
    () => kitUnitCostCents({ ...certified, items: [item("x", { unitCostCents: -1 })] }),
    RangeError,
  );
  assert.throws(
    () => kitUnitCostCents({ ...certified, items: [item("x", { quantity: 0 })] }),
    RangeError,
  );
});

Deno.test("semana começa na segunda-feira de São Paulo", () => {
  assert.equal(weekOf(new Date("2026-11-25T12:00:00Z")), "2026-11-23");
  assert.equal(weekOf(new Date("2026-11-30T02:00:00Z")), "2026-11-23");
  assert.equal(weekOf(new Date("2026-11-30T03:00:00Z")), "2026-11-30");
  assert.throws(() => weekOf(new Date("x")), RangeError);
});

Deno.test("seleção semanal recomenda os melhores elegíveis e explica cada rejeição", () => {
  const at = new Date("2026-06-15T12:00:00Z");
  const selection = weeklySelection(
    [
      candidate("forte"),
      candidate("medio", {
        scoring: { ...scoring, market: { ...scoring.market, weeksInRanking: 1, bestPosition: 18 } },
      }),
      candidate("terceiro", {
        scoring: { ...scoring, market: { ...scoring.market, weeksInRanking: 1, bestPosition: 20 } },
      }),
      candidate("sem-custo", { scoring: null }),
      candidate("escolar", { season: BACK_TO_SCHOOL }),
      candidate("caro", {
        scoring: { ...scoring, economics: { ...scoring.economics, unitCostCents: 6_000 } },
      }),
      candidate("lento", { supplier: { ...supplier, handlingDays: 5 } }),
      candidate("kit", {
        kit: {
          items: [item("a"), item("b", { supplierId: "x" })],
          assembledBySupplier: true,
          assemblerMeetsAnnexB: true,
        },
      }),
    ],
    limits,
    at,
    2,
  );

  assert.equal(selection.week, "2026-06-15");
  assert.deepEqual(selection.recommended.map((e) => e.key), ["forte", "medio"]);
  assert.deepEqual(selection.deferred.map((e) => e.key), ["terceiro"]);
  assert.deepEqual(
    Object.fromEntries(selection.rejected.map((e) => [e.key, e.reasons])),
    {
      "sem-custo": ["missing_costs"],
      escolar: ["off_season"],
      caro: ["not_viable"],
      lento: ["supplier_too_slow"],
      kit: ["mixed_suppliers"],
    },
  );
  assert.equal(selection.rejected.find((e) => e.key === "escolar")?.phase, "off_season");

  assert.deepEqual(
    weeklySelection(
      [candidate("escolar", { season: BACK_TO_SCHOOL })],
      limits,
      new Date("2026-11-25T12:00:00Z"),
      1,
    )
      .recommended.map((e) => [e.key, e.phase]),
    [["escolar", "in_season"]],
  );
  assert.throws(() => weeklySelection([candidate("a"), candidate("a")], limits, at, 1), RangeError);
  assert.throws(() => weeklySelection([], limits, at, 0), RangeError);
});

Deno.test("linhas da seleção seguem o contrato do banco", () => {
  const supplierId = "20000000-0000-0000-0000-0000000000e1";
  const rows = selectionRows(
    weeklySelection(
      [candidate("forte", { supplierId }), candidate("sem-custo", { scoring: null })],
      limits,
      new Date("2026-11-25T12:00:00Z"),
      1,
    ),
  );
  assert.deepEqual(rows.map((r) => [r.product_key, r.status, r.supplier_id]), [
    ["forte", "recommended", supplierId],
    ["sem-custo", "rejected", null],
  ]);
  assert.equal(rows[0]!.stressed_contribution_cents! > 0, true);
  assert.deepEqual(rows[1]!.reasons, ["missing_costs"]);
});

Deno.test("seleção semanal é reproduzível e independe da ordem de entrada", () => {
  const at = new Date("2026-06-15T12:00:00Z");
  const candidates = [
    candidate("forte"),
    candidate("empate-b"),
    candidate("empate-a"),
    candidate("sem-custo", { scoring: null }),
    candidate("lento", { supplier: { ...supplier, handlingDays: 5 } }),
  ];
  const first = weeklySelection(candidates, limits, at, 2);
  assert.deepEqual(weeklySelection(candidates, limits, at, 2), first);
  assert.deepEqual(weeklySelection([...candidates].reverse(), limits, at, 2), first);
});
