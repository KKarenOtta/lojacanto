import assert from "node:assert/strict";
import {
  estimatedSaleFee,
  type FeeSchedule,
  lineContribution,
  type LineInput,
  minimumPrice,
  type MinimumPriceInput,
  unitContribution,
} from "./contribution.ts";
import { applyRate } from "./rates.ts";

const line: LineInput = {
  unitPriceCents: 5000,
  quantity: 1,
  saleFeeCents: 1200,
  unitCostCents: 2000,
  supplierShippingCents: 300,
  sellerShippingCents: 0,
  refundedCents: 0,
  taxBps: 0,
};

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const int = (next: () => number, max: number) => Math.floor(next() * (max + 1));

Deno.test("contribuição de pedido do exemplo oficial", () => {
  assert.deepEqual(lineContribution(line), {
    status: "known",
    revenueCents: 5000,
    saleFeeCents: 1200,
    costCents: 2000,
    shippingCents: 300,
    taxCents: 0,
    contributionCents: 1500,
    marginBps: 3000,
  });
});

Deno.test("custo essencial ausente torna a margem desconhecida", () => {
  assert.deepEqual(
    lineContribution({ ...line, unitCostCents: null, sellerShippingCents: null }),
    { status: "unknown", missing: ["unitCost", "sellerShipping"] },
  );
  assert.deepEqual(lineContribution({ ...line, saleFeeCents: null }), {
    status: "unknown",
    missing: ["saleFee"],
  });
});

Deno.test("devolução parcial reduz receita e imposto", () => {
  const result = lineContribution({ ...line, quantity: 2, refundedCents: 5000, taxBps: 600 });
  assert.equal(result.status, "known");
  if (result.status !== "known") return;
  assert.equal(result.revenueCents, 5000);
  assert.equal(result.costCents, 4000);
  assert.equal(result.taxCents, 300);
  assert.equal(result.contributionCents, 5000 - 1200 - 4000 - 300 - 300);
});

Deno.test("devolução total deixa margem indefinida", () => {
  const result = lineContribution({ ...line, refundedCents: 5000 });
  assert.equal(result.status === "known" && result.marginBps, null);
});

Deno.test("entradas inválidas são recusadas", () => {
  assert.throws(() => lineContribution({ ...line, quantity: 0 }), RangeError);
  assert.throws(() => lineContribution({ ...line, quantity: 1.5 }), RangeError);
  assert.throws(() => lineContribution({ ...line, unitCostCents: -1 }), RangeError);
  assert.throws(() => lineContribution({ ...line, unitPriceCents: -1 }), RangeError);
  assert.throws(() => lineContribution({ ...line, refundedCents: 5001 }), RangeError);
  assert.throws(() => lineContribution({ ...line, saleFeeCents: 0.5 }), RangeError);
});

Deno.test("propriedade: componentes somam exatamente a receita", () => {
  const next = random(42);
  for (let i = 0; i < 2_000; i++) {
    const quantity = 1 + int(next, 9);
    const unitPriceCents = int(next, 500_000);
    const input: LineInput = {
      unitPriceCents,
      quantity,
      saleFeeCents: int(next, unitPriceCents * quantity),
      unitCostCents: int(next, unitPriceCents),
      supplierShippingCents: int(next, 5_000),
      sellerShippingCents: int(next, 5_000),
      refundedCents: int(next, unitPriceCents * quantity),
      taxBps: int(next, 2_000),
    };
    const result = lineContribution(input);
    assert.equal(result.status, "known");
    if (result.status !== "known") continue;
    assert.ok(Number.isSafeInteger(result.contributionCents));
    assert.equal(
      result.saleFeeCents + result.costCents + result.shippingCents + result.taxCents +
        result.contributionCents,
      result.revenueCents,
    );
  }
});

Deno.test("tarifa estimada combina percentual e fixa por unidade", () => {
  assert.equal(estimatedSaleFee(5000, 2, { percentageBps: 1200, fixedCents: 650 }), 2500);
});

const schedule: FeeSchedule = (price) => ({
  percentageBps: 1400,
  fixedCents: price < 7900 ? 650 : 0,
});

const base: MinimumPriceInput = {
  unitCostCents: 2000,
  supplierShippingCents: 300,
  sellerShippingCents: 0,
  taxBps: 0,
  targetMarginBps: 1500,
  fees: schedule,
};

Deno.test("preço mínimo é o menor preço que atinge a margem-alvo", () => {
  const price = minimumPrice(base)!;
  const meets = (p: number) => unitContribution(p, base) >= applyRate(p, base.targetMarginBps);
  assert.ok(meets(price));
  assert.ok(!meets(price - 1));
});

Deno.test("preço mínimo considera a mudança da tarifa fixa por faixa", () => {
  const price = minimumPrice({ ...base, unitCostCents: 4700 })!;
  assert.ok(price <= 7900);
  assert.ok(unitContribution(7900, { ...base, unitCostCents: 4700 }) >= 0);
});

Deno.test("preço mínimo inexistente quando a margem é inalcançável", () => {
  assert.equal(minimumPrice({ ...base, targetMarginBps: 9000 }), null);
});

Deno.test("propriedade: preço mínimo é limite inferior exato", () => {
  const next = random(7);
  for (let i = 0; i < 300; i++) {
    const input: MinimumPriceInput = {
      unitCostCents: int(next, 50_000),
      supplierShippingCents: int(next, 3_000),
      sellerShippingCents: int(next, 3_000),
      taxBps: int(next, 1_500),
      targetMarginBps: int(next, 4_000),
      fees: schedule,
    };
    const price = minimumPrice(input);
    if (price === null) continue;
    const meets = (p: number) => unitContribution(p, input) >= applyRate(p, input.targetMarginBps);
    assert.ok(meets(price));
    if (price > 0) assert.ok(!meets(price - 1));
  }
});
