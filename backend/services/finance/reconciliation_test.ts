import assert from "node:assert/strict";
import { realizedContribution, reconcile } from "./reconciliation.ts";

Deno.test("conciliação marca divergência acima da tolerância", () => {
  const result = reconcile(
    { revenue: 7990, sale_fee: 1119, seller_shipping: 0 },
    { revenue: 7990, sale_fee: 1123, seller_shipping: 819 },
    50,
  );
  assert.deepEqual(
    result.map((d) => [d.kind, d.differenceCents, d.differenceBps, d.withinTolerance]),
    [
      ["revenue", 0, 0, true],
      ["sale_fee", 4, 36, true],
      ["seller_shipping", 819, null, false],
    ],
  );
});

Deno.test("lado ausente não é considerado conciliado", () => {
  const [entry] = reconcile({ product_cost: 3000 }, {}, 50);
  assert.deepEqual(entry, {
    kind: "product_cost",
    estimatedCents: 3000,
    realizedCents: null,
    differenceCents: null,
    differenceBps: null,
    withinTolerance: false,
  });
});

Deno.test("conciliação recusa valores não inteiros e tolerância inválida", () => {
  assert.throws(() => reconcile({ revenue: 1.5 }, { revenue: 1 }, 50), RangeError);
  assert.throws(() => reconcile({ revenue: 1 }, { revenue: 0.1 }, 50), RangeError);
  assert.throws(() => reconcile({}, {}, -1), RangeError);
});

Deno.test("contribuição realizada exige todos os componentes e desconta devoluções", () => {
  const complete = {
    revenue: 7990,
    sale_fee: 1119,
    seller_shipping: 819,
    product_cost: 3000,
    supplier_shipping: 500,
    tax: 0,
  };
  assert.equal(realizedContribution(complete), 2552);
  assert.equal(realizedContribution({ ...complete, refund: 3995 }), -1443);
  assert.equal(realizedContribution({ revenue: 7990 }), null);
});
