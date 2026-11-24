import assert from "node:assert/strict";
import { createLogger } from "../../shared/log.ts";
import { createTelegramAlerter, formatAlert } from "./alerts.ts";

const TOKEN = "1234567890:AAH_fake-token-for-tests-only";

function setup(respond: () => Promise<Response>) {
  const lines: string[] = [];
  const requests: Request[] = [];
  const alerter = createTelegramAlerter({
    token: TOKEN,
    chatId: "98765",
    logger: createLogger({}, (line) => lines.push(line)),
    fetch: (input, init) => {
      requests.push(new Request(input, init));
      return respond();
    },
  });
  return { alerter, lines, requests };
}

Deno.test("formatAlert inclui severidade, título, detalhe e referência", () => {
  assert.equal(
    formatAlert({
      severity: "critical",
      title: "Fila parada",
      detail: "12 itens",
      correlationId: "c1",
    }),
    "[CRÍTICO] Fila parada\n12 itens\nref: c1",
  );
  assert.equal(formatAlert({ severity: "info", title: "T", detail: "D" }), "[INFO] T\nD");
});

Deno.test("formatAlert limita o tamanho da mensagem", () => {
  const text = formatAlert({ severity: "warning", title: "T", detail: "x".repeat(5_000) });
  assert.equal(text.length, 1_000);
  assert.ok(text.endsWith("…"));
});

Deno.test("send publica no chat configurado e registra sucesso sem o token", async () => {
  const { alerter, lines, requests } = setup(() => Promise.resolve(new Response("{}")));
  assert.equal(await alerter.send({ severity: "warning", title: "Teste", detail: "ok" }), true);
  assert.equal(requests[0]!.method, "POST");
  assert.equal(requests[0]!.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.deepEqual(await requests[0]!.json(), {
    chat_id: "98765",
    text: "[ATENÇÃO] Teste\nok",
    disable_web_page_preview: true,
  });
  assert.ok(lines.every((line) => !line.includes(TOKEN)));
});

Deno.test("send retorna false em resposta de erro", async () => {
  const { alerter, lines } = setup(() => Promise.resolve(new Response("", { status: 403 })));
  assert.equal(await alerter.send({ severity: "critical", title: "X", detail: "Y" }), false);
  assert.equal(JSON.parse(lines[0]!).status, 403);
});

Deno.test("falha de rede não lança e não expõe o token no log", async () => {
  const { alerter, lines } = setup(() =>
    Promise.reject(
      new TypeError(`error sending request for url (https://api.telegram.org/bot${TOKEN}/x)`),
    )
  );
  assert.equal(await alerter.send({ severity: "critical", title: "X", detail: "Y" }), false);
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes(TOKEN));
});
