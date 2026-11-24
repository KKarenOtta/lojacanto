import assert from "node:assert/strict";
import { AuthorizationError, UpstreamError } from "../../shared/errors.ts";
import { createLogger } from "../../shared/log.ts";
import { backoffDelay, createMercadoLivreClient } from "./client.ts";

const TOKEN = "APP_USR-1234567890-112426-abcdef0123456789-478055419";

function setup(responses: Array<Response | Error>) {
  const lines: string[] = [];
  const delays: number[] = [];
  const requests: Request[] = [];
  const client = createMercadoLivreClient({
    baseUrl: "https://api.test",
    accessToken: () => Promise.resolve(TOKEN),
    logger: createLogger({}, (line) => lines.push(line)),
    fetch: (input, init) => {
      requests.push(new Request(input, init));
      const next = responses.shift();
      if (!next) throw new Error("no response configured");
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
  });
  return { client, lines, delays, requests };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

Deno.test("get envia token no header e devolve o JSON", async () => {
  const { client, requests } = setup([ok({ id: 1 })]);
  assert.deepEqual(await client.get("/orders/1", { "x-format-new": "true" }), { id: 1 });
  assert.equal(requests[0]!.url, "https://api.test/orders/1");
  assert.equal(requests[0]!.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(requests[0]!.headers.get("x-format-new"), "true");
});

Deno.test("429 e 5xx são repetidos com backoff exponencial e jitter", async () => {
  const { client, delays } = setup([
    new Response("", { status: 429 }),
    new Response("", { status: 503 }),
    ok({ id: 2 }),
  ]);
  assert.deepEqual(await client.get("/orders/2"), { id: 2 });
  assert.deepEqual(delays, [250, 500]);
});

Deno.test("falha de rede é repetida e erro final é propagado após o limite", async () => {
  const { client, delays } = setup([
    new TypeError("connection reset"),
    new TypeError("connection reset"),
    new TypeError("connection reset"),
    new TypeError("connection reset"),
  ]);
  await assert.rejects(client.get("/orders/3"), (error: unknown) => {
    assert.ok(error instanceof UpstreamError);
    assert.equal(error.status, 0);
    return true;
  });
  assert.equal(delays.length, 3);
});

Deno.test("4xx não é repetido e 401 vira AuthorizationError", async () => {
  const notFound = setup([new Response("", { status: 404 })]);
  await assert.rejects(notFound.client.get("/orders/4"), (error: unknown) => {
    assert.ok(error instanceof UpstreamError);
    assert.equal(error.status, 404);
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(notFound.delays.length, 0);

  const unauthorized = setup([new Response("", { status: 401 })]);
  await assert.rejects(unauthorized.client.get("/orders/5"), AuthorizationError);
});

Deno.test("caminho absoluto ou externo é recusado", async () => {
  const { client } = setup([]);
  await assert.rejects(client.get("https://evil.test/x"), RangeError);
  await assert.rejects(client.get("orders/1"), RangeError);
});

Deno.test("logs nunca contêm o token", async () => {
  const { client, lines } = setup([new Response("", { status: 500 }), ok({})]);
  await client.get("/orders/6");
  assert.ok(lines.length > 0);
  for (const line of lines) assert.ok(!line.includes(TOKEN));
});

Deno.test("backoffDelay cresce exponencialmente até o teto", () => {
  assert.equal(backoffDelay(1, () => 0.999), 499);
  assert.equal(backoffDelay(5, () => 0.999), 7992);
  assert.equal(backoffDelay(10, () => 0.999), 7992);
  assert.equal(backoffDelay(3, () => 0), 0);
});

Deno.test("post envia corpo JSON e só repete em 429, nunca em 5xx ou rede", async () => {
  const throttled = setup([new Response("", { status: 429 }), ok({ id: "c1" })]);
  assert.deepEqual(await throttled.client.post("/mlb/order/1/dce/emission"), { id: "c1" });
  assert.equal(throttled.requests[1]!.method, "POST");
  assert.equal(throttled.delays.length, 1);

  const withBody = setup([new Response("", { status: 200 })]);
  assert.equal(await withBody.client.post("/x", { a: 1 }), null);
  assert.deepEqual(await withBody.requests[0]!.json(), { a: 1 });
  assert.equal(withBody.requests[0]!.headers.get("content-type"), "application/json");

  const failing = setup([new Response("", { status: 503 })]);
  await assert.rejects(failing.client.post("/x"), UpstreamError);
  assert.equal(failing.delays.length, 0);

  const network = setup([new TypeError("reset")]);
  await assert.rejects(network.client.post("/x"), UpstreamError);
  assert.equal(network.delays.length, 0);

  await assert.rejects(failing.client.post("https://evil.test"), RangeError);
});
