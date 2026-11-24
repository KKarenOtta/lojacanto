import assert from "node:assert/strict";
import { correlationId, json } from "./http.ts";

const VALID = "3f6da1e3-5ac8-4f70-a24a-f7360d24c7bc";

Deno.test("correlationId reutiliza UUID válido recebido", () => {
  const request = new Request("https://x.test", { headers: { "x-correlation-id": VALID } });
  assert.deepEqual(correlationId(request, () => "gerado"), VALID);
});

Deno.test("correlationId gera novo valor quando ausente ou inválido", () => {
  const invalid = new Request("https://x.test", { headers: { "x-correlation-id": "abc;drop" } });
  assert.deepEqual(correlationId(invalid, () => "gerado"), "gerado");
  assert.deepEqual(correlationId(new Request("https://x.test"), () => "gerado"), "gerado");
});

Deno.test("json define status, tipo e desativa cache", async () => {
  const response = json({ ok: true }, 201, { "x-extra": "1" });
  assert.deepEqual(response.status, 201);
  assert.deepEqual(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.headers.get("x-extra"), "1");
  assert.deepEqual(await response.json(), { ok: true });
});
