import assert from "node:assert/strict";
import type { Notification } from "../integrations/mercadolivre/notifications.ts";
import { createLogger } from "../shared/log.ts";
import { createNotificationHandler } from "./ml_notifications.ts";

const fixture = await Deno.readTextFile(
  new URL("../integrations/mercadolivre/fixtures/notification_orders_v2.json", import.meta.url),
);

function setup(options: {
  applicationId?: number | null;
  enqueue?: () => Promise<boolean>;
  trusted?: boolean;
} = {}) {
  const lines: string[] = [];
  const queued: Notification[] = [];
  const handler = createNotificationHandler({
    applicationId: options.applicationId === undefined ? 5503910054141466 : options.applicationId,
    logger: createLogger({}, (line) => lines.push(line)),
    trustSource: () => options.trusted ?? true,
    enqueue: (notification) => {
      queued.push(notification);
      return options.enqueue ? options.enqueue() : Promise.resolve(true);
    },
  });
  return { handler, lines, queued };
}

const post = (body: string) =>
  new Request("https://fn.test/ml-notifications", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": "54.88.218.97" },
  });

Deno.test("notificação válida é enfileirada e respondida com 200", async () => {
  const { handler, queued } = setup();
  const response = await handler(post(fixture));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "queued" });
  assert.equal(queued[0]!.resource, "/orders/2195160686");
});

Deno.test("notificação repetida responde duplicate", async () => {
  const { handler } = setup({ enqueue: () => Promise.resolve(false) });
  assert.deepEqual(await (await handler(post(fixture))).json(), { status: "duplicate" });
});

Deno.test("origem fora da lista oficial é recusada", async () => {
  const { handler, queued } = setup({ trusted: false });
  assert.equal((await handler(post(fixture))).status, 403);
  assert.equal(queued.length, 0);
});

Deno.test("payload inválido, grande ou de outra aplicação é ignorado sem enfileirar", async () => {
  const { handler, queued } = setup();
  assert.deepEqual(await (await handler(post("{"))).json(), { status: "ignored" });
  assert.deepEqual(
    await (await handler(post(JSON.stringify({ ...JSON.parse(fixture), topic: "x" })))).json(),
    { status: "ignored" },
  );
  assert.deepEqual(
    await (await handler(post(JSON.stringify({ ...JSON.parse(fixture), application_id: 1 }))))
      .json(),
    { status: "ignored" },
  );
  assert.equal((await handler(post("x".repeat(9_000)))).status, 413);
  assert.equal(queued.length, 0);
});

Deno.test("método diferente de POST e aplicação não configurada", async () => {
  const { handler } = setup();
  assert.equal((await handler(new Request("https://fn.test/", { method: "GET" }))).status, 405);
  const unconfigured = setup({ applicationId: null });
  assert.equal((await unconfigured.handler(post(fixture))).status, 503);
});

Deno.test("falha ao enfileirar devolve 503 para o Mercado Livre repetir", async () => {
  const { handler, lines } = setup({ enqueue: () => Promise.reject(new Error("down")) });
  assert.equal((await handler(post(fixture))).status, 503);
  assert.equal(JSON.parse(lines.at(-1)!).event, "notification.enqueue_failed");
});
