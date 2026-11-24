import assert from "node:assert/strict";
import { createLogger } from "../shared/log.ts";
import { createHealthHandler, defaultHealthHandler } from "./health.ts";

const CORRELATION = "3f6da1e3-5ac8-4f70-a24a-f7360d24c7bc";

function setup() {
  const lines: string[] = [];
  const handler = createHealthHandler({
    version: "1.2.3",
    now: () => new Date("2026-11-24T12:00:00.000Z"),
    logger: createLogger({}, (line) => lines.push(line)),
  });
  return { handler, lines };
}

Deno.test("GET retorna status, versão e horário com correlation id", async () => {
  const { handler, lines } = setup();
  const response = handler(
    new Request("https://x.test/health", { headers: { "x-correlation-id": CORRELATION } }),
  );
  assert.deepEqual(response.status, 200);
  assert.deepEqual(response.headers.get("x-correlation-id"), CORRELATION);
  assert.deepEqual(await response.json(), {
    status: "ok",
    version: "1.2.3",
    time: "2026-11-24T12:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(lines[0]!).correlation_id, CORRELATION);
});

Deno.test("métodos diferentes de GET retornam 405", async () => {
  const { handler, lines } = setup();
  const response = handler(new Request("https://x.test/health", { method: "POST" }));
  assert.deepEqual(response.status, 405);
  assert.deepEqual(response.headers.get("allow"), "GET");
  assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  assert.deepEqual(lines.length, 0);
});

Deno.test("handler padrão usa APP_VERSION do ambiente", async () => {
  Deno.env.set("APP_VERSION", "abc123");
  try {
    const response = defaultHealthHandler()(new Request("https://x.test/health"));
    assert.deepEqual((await response.json()).version, "abc123");
  } finally {
    Deno.env.delete("APP_VERSION");
  }
});
