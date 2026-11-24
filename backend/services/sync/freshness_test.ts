import assert from "node:assert/strict";
import { isNewer } from "./freshness.ts";

Deno.test("isNewer aplica apenas versões estritamente mais recentes", () => {
  assert.equal(isNewer(null, "2022-04-08T21:03:32.000Z"), true);
  assert.equal(isNewer("2022-04-08T21:03:32.000Z", "2022-04-08T21:03:33.000Z"), true);
  assert.equal(isNewer("2022-04-08T21:03:32.000Z", "2022-04-08T21:03:32.000Z"), false);
  assert.equal(isNewer("2022-04-08T21:03:32.000Z", "2022-04-08T21:03:31.000Z"), false);
});

Deno.test("isNewer compara instantes independentemente do fuso", () => {
  assert.equal(isNewer("2022-04-08T21:03:32.000Z", "2022-04-08T17:03:32.000-04:00"), false);
  assert.equal(isNewer("2022-04-08T21:03:32.000Z", "2022-04-08T17:03:33.000-04:00"), true);
});

Deno.test("isNewer rejeita datas inválidas", () => {
  assert.throws(() => isNewer(null, "ontem"), RangeError);
  assert.throws(() => isNewer("ontem", "2022-04-08T21:03:32.000Z"), RangeError);
});
