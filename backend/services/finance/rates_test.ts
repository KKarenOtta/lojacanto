import assert from "node:assert/strict";
import { applyRate, rateOf } from "./rates.ts";

Deno.test("applyRate arredonda meio centavo para longe de zero", () => {
  assert.equal(applyRate(5000, 1200), 600);
  assert.equal(applyRate(1, 5000), 1);
  assert.equal(applyRate(-1, 5000), -1);
  assert.equal(applyRate(333, 1500), 50);
  assert.equal(applyRate(0, 1999), 0);
});

Deno.test("applyRate é exato em valores grandes", () => {
  assert.equal(applyRate(Number.MAX_SAFE_INTEGER, 10_000), Number.MAX_SAFE_INTEGER);
});

Deno.test("applyRate recusa entradas inválidas", () => {
  assert.throws(() => applyRate(1.5, 100), RangeError);
  assert.throws(() => applyRate(100, -1), RangeError);
  assert.throws(() => applyRate(100, 10_001), RangeError);
  assert.throws(() => applyRate(100, 12.5), RangeError);
});

Deno.test("rateOf devolve pontos-base arredondados e null sem base", () => {
  assert.equal(rateOf(1500, 5000), 3000);
  assert.equal(rateOf(1, 3), 3333);
  assert.equal(rateOf(2, 3), 6667);
  assert.equal(rateOf(-2, 3), -6667);
  assert.equal(rateOf(10, 0), null);
});
