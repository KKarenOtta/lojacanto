import assert from "node:assert/strict";
import { ContractError } from "./errors.ts";
import { toBasisPoints, toCents } from "./money.ts";

Deno.test("toCents converte números e textos sem erro de ponto flutuante", () => {
  assert.equal(toCents(50, "x"), 5000);
  assert.equal(toCents(9.99, "x"), 999);
  assert.equal(toCents(0.1, "x"), 10);
  assert.equal(toCents("1234.5", "x"), 123450);
  assert.equal(toCents("-12.30", "x"), -1230);
  assert.equal(toCents(0, "x"), 0);
});

Deno.test("toCents rejeita valores fora do contrato indicando o campo", () => {
  for (const value of [null, undefined, "abc", "1.234", 1e21, "1e3", {}, NaN]) {
    assert.throws(() => toCents(value, "order.total_amount"), (error: unknown) => {
      assert.ok(error instanceof ContractError);
      assert.equal(error.path, "order.total_amount");
      return true;
    });
  }
});

Deno.test("toCents rejeita artefato de ponto flutuante em vez de arredondar", () => {
  assert.throws(() => toCents(1.005 * 1000, "x"), ContractError);
});

Deno.test("toCents rejeita valores acima do inteiro seguro", () => {
  assert.throws(() => toCents("90071992547409.92", "x"), ContractError);
});

Deno.test("toBasisPoints converte percentual decimal em pontos-base", () => {
  assert.equal(toBasisPoints(15.5, "p"), 1550);
  assert.equal(toBasisPoints("13", "p"), 1300);
  assert.throws(() => toBasisPoints(100.01, "p"), ContractError);
  assert.throws(() => toBasisPoints(-1, "p"), ContractError);
});
