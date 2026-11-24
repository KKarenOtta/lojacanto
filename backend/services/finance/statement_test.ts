import assert from "node:assert/strict";
import { canFundPurchase, cashCycleDays, projectCash } from "./cashflow.ts";
import { breakEvenRevenue, incomeStatement } from "./statement.ts";

Deno.test("DRE gerencial separa deduções, custos variáveis e despesas fixas", () => {
  const statement = incomeStatement({
    revenue: 1_000_000,
    refund: 50_000,
    tax: 0,
    product_cost: 400_000,
    supplier_shipping: 30_000,
    sale_fee: 130_000,
    seller_shipping: 40_000,
  }, 150_000);
  assert.deepEqual(statement, {
    grossRevenueCents: 1_000_000,
    refundsCents: 50_000,
    salesTaxCents: 0,
    netRevenueCents: 950_000,
    variableCostsCents: 600_000,
    contributionCents: 350_000,
    contributionMarginBps: 3684,
    fixedExpensesCents: 150_000,
    operatingResultCents: 200_000,
    breakEvenRevenueCents: 407_167,
  });
});

Deno.test("ponto de equilíbrio arredonda para cima e não existe sem margem positiva", () => {
  assert.equal(breakEvenRevenue(100_000, 2_500), 400_000);
  assert.equal(breakEvenRevenue(100_001, 3_000), 333_337);
  assert.equal(breakEvenRevenue(100_000, 0), null);
  assert.equal(breakEvenRevenue(100_000, null), null);
  assert.equal(incomeStatement({}, 0).breakEvenRevenueCents, null);
});

Deno.test("ciclo financeiro conta os dias entre pagar o fornecedor e receber a liberação", () => {
  assert.equal(cashCycleDays("2026-12-01", "2026-12-15"), 14);
  assert.throws(() => cashCycleDays("2026-13-01", "2026-12-15"), RangeError);
});

Deno.test("projeção de caixa encontra a maior necessidade de capital de giro", () => {
  const projection = projectCash(10_000, [
    { date: "2026-12-02", amountCents: -8_000 },
    { date: "2026-12-01", amountCents: -6_000 },
    { date: "2026-12-10", amountCents: 9_000 },
    { date: "2026-12-12", amountCents: 9_500 },
  ]);
  assert.deepEqual(projection, {
    peakNeedCents: 4_000,
    peakDate: "2026-12-02",
    endingBalanceCents: 14_500,
  });
  assert.deepEqual(projectCash(0, []), { peakNeedCents: 0, peakDate: null, endingBalanceCents: 0 });
  assert.throws(() => projectCash(0, [{ date: "x", amountCents: 1 }]), RangeError);
});

Deno.test("compra só é financiada com caixa disponível acima da reserva", () => {
  const committed = [
    { date: "2026-12-01", amountCents: -5_000 },
    { date: "2026-12-20", amountCents: 7_000 },
  ];
  assert.equal(
    canFundPurchase(10_000, committed, { date: "2026-12-02", amountCents: -3_000 }, 1_000),
    true,
  );
  assert.equal(
    canFundPurchase(10_000, committed, { date: "2026-12-02", amountCents: -4_500 }, 1_000),
    false,
  );
  assert.equal(
    canFundPurchase(10_000, committed, { date: "2026-12-21", amountCents: -9_000 }, 1_000),
    true,
  );
});
