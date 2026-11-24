import assert from "node:assert/strict";
import { UpstreamError } from "../../shared/errors.ts";
import { createRpc } from "./rpc.ts";

const KEY = "service-key-fixture";

function setup(respond: () => Promise<Response>) {
  const requests: Request[] = [];
  const rpc = createRpc({
    url: "https://db.test/",
    serviceKey: KEY,
    fetch: (input, init) => {
      requests.push(new Request(input, init));
      return respond();
    },
  });
  return { rpc, requests };
}

Deno.test("rpc envia argumentos e chave de serviço", async () => {
  const { rpc, requests } = setup(() => Promise.resolve(new Response("true")));
  assert.equal(
    await rpc<boolean>("enqueue_marketplace_notification", { p_topic: "orders_v2" }),
    true,
  );
  assert.equal(requests[0]!.url, "https://db.test/rest/v1/rpc/enqueue_marketplace_notification");
  assert.equal(requests[0]!.headers.get("apikey"), KEY);
  assert.equal(requests[0]!.headers.get("authorization"), `Bearer ${KEY}`);
  assert.deepEqual(await requests[0]!.json(), { p_topic: "orders_v2" });
});

Deno.test("rpc devolve null para função void", async () => {
  const { rpc } = setup(() => Promise.resolve(new Response("", { status: 200 })));
  assert.equal(await rpc("complete_marketplace_notification", {}), null);
});

Deno.test("rpc classifica erros do banco", async () => {
  const forbidden = setup(() => Promise.resolve(new Response("{}", { status: 403 })));
  await assert.rejects(forbidden.rpc("x", {}), (error: unknown) => {
    assert.ok(error instanceof UpstreamError);
    assert.equal(error.retryable, false);
    return true;
  });
  const down = setup(() => Promise.reject(new TypeError("reset")));
  await assert.rejects(down.rpc("x", {}), (error: unknown) => {
    assert.ok(error instanceof UpstreamError);
    assert.equal(error.retryable, true);
    return true;
  });
});

Deno.test("rpc recusa nome de função fora do padrão", async () => {
  const { rpc } = setup(() => Promise.resolve(new Response("")));
  await assert.rejects(rpc("../auth/v1", {}), RangeError);
});
