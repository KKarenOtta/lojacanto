import assert from "node:assert/strict";
import { createLogger } from "../shared/log.ts";
import {
  alertChannelStatus,
  type CheckStatus,
  createHealthHandler,
  defaultHealthHandler,
} from "./health.ts";

const CORRELATION = "3f6da1e3-5ac8-4f70-a24a-f7360d24c7bc";

function setup(alertChannel: CheckStatus = "ok") {
  const lines: string[] = [];
  const handler = createHealthHandler({
    version: "1.2.3",
    now: () => new Date("2026-11-24T12:00:00.000Z"),
    logger: createLogger({}, (line) => lines.push(line)),
    alertChannel,
  });
  return { handler, lines };
}

function env(values: Record<string, string>) {
  return { get: (key: string) => values[key] };
}

Deno.test("GET retorna status, versão, horário e checks com correlation id", async () => {
  const { handler, lines } = setup();
  const response = handler(
    new Request("https://x.test/health", { headers: { "x-correlation-id": CORRELATION } }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-correlation-id"), CORRELATION);
  assert.deepEqual(await response.json(), {
    status: "ok",
    version: "1.2.3",
    time: "2026-11-24T12:00:00.000Z",
    checks: { alert_channel: "ok" },
  });
  assert.equal(JSON.parse(lines[0]!).correlation_id, CORRELATION);
});

Deno.test("check com falha torna o status degraded sem mudar o HTTP 200", async () => {
  const { handler } = setup("missing");
  const response = handler(new Request("https://x.test/health"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "degraded");
  assert.deepEqual(body.checks, { alert_channel: "missing" });
});

Deno.test("métodos diferentes de GET retornam 405", async () => {
  const { handler, lines } = setup();
  const response = handler(new Request("https://x.test/health", { method: "POST" }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  assert.equal(lines.length, 0);
});

Deno.test("alertChannelStatus valida presença e formato sem expor valores", () => {
  assert.equal(alertChannelStatus(env({})), "missing");
  assert.equal(alertChannelStatus(env({ TELEGRAM_BOT_TOKEN: "123:abc_D-e" })), "missing");
  assert.equal(
    alertChannelStatus(env({ TELEGRAM_BOT_TOKEN: "123:abc_D-e", TELEGRAM_CHAT_ID: "98765" })),
    "ok",
  );
  assert.equal(
    alertChannelStatus(env({ TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "-100987" })),
    "ok",
  );
  assert.equal(
    alertChannelStatus(env({ TELEGRAM_BOT_TOKEN: "sem-formato", TELEGRAM_CHAT_ID: "98765" })),
    "invalid",
  );
  assert.equal(
    alertChannelStatus(env({ TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "@karen" })),
    "invalid",
  );
});

Deno.test("handler padrão usa APP_VERSION e o ambiente", async () => {
  Deno.env.set("APP_VERSION", "abc123");
  try {
    const body = await defaultHealthHandler()(new Request("https://x.test/health")).json();
    assert.equal(body.version, "abc123");
    assert.equal(body.checks.alert_channel, "missing");
  } finally {
    Deno.env.delete("APP_VERSION");
  }
});
