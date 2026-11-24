import assert from "node:assert/strict";
import { createLogger, redact } from "./log.ts";

Deno.test("redact mascara chaves sensíveis em qualquer profundidade", () => {
  const result = redact({
    order: { id: 1, access_token: "abc", nested: [{ Authorization: "Bearer x" }] },
    client_secret: "s",
    password: "p",
  });
  assert.deepEqual(result, {
    order: { id: 1, access_token: "[REDACTED]", nested: [{ Authorization: "[REDACTED]" }] },
    client_secret: "[REDACTED]",
    password: "[REDACTED]",
  });
});

Deno.test("redact mascara tokens do Mercado Livre dentro de texto", () => {
  const text = "falha com APP_USR-123-090515-abc e TG-5b9032b4 via Bearer xyz";
  assert.deepEqual(redact(text), "falha com [REDACTED] e [REDACTED] via [REDACTED]");
});

Deno.test("redact limita profundidade e serializa erros sem stack", () => {
  let deep: Record<string, unknown> = { value: 1 };
  for (let i = 0; i < 12; i++) deep = { next: deep };
  assert.match(JSON.stringify(redact(deep)), /\[REDACTED\]/);
  assert.deepEqual(redact(new Error("token APP_USR-1-2")), {
    name: "Error",
    message: "token [REDACTED]",
  });
});

Deno.test("logger emite JSON com nível, evento, campos base e redação", () => {
  const lines: string[] = [];
  const logger = createLogger(
    { service: "test" },
    (line) => lines.push(line),
    () => new Date("2026-11-24T12:00:00.000Z"),
  ).child({ store_id: "s1" });

  logger.debug("a");
  logger.info("b", { refresh_token: "TG-1" });
  logger.warn("c");
  logger.error("d", { error: new Error("x") });

  assert.deepEqual(lines.map((line) => JSON.parse(line).level), ["debug", "info", "warn", "error"]);
  assert.deepEqual(JSON.parse(lines[1]!), {
    ts: "2026-11-24T12:00:00.000Z",
    level: "info",
    event: "b",
    service: "test",
    store_id: "s1",
    refresh_token: "[REDACTED]",
  });
});
