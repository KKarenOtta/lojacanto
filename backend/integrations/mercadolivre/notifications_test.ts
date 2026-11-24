import assert from "node:assert/strict";
import { ContractError } from "../../shared/errors.ts";
import { clientIp, isNotificationSource, parseNotification } from "./notifications.ts";

const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/notification_orders_v2.json", import.meta.url)),
);

Deno.test("parseNotification aceita o formato documentado de orders_v2", () => {
  assert.deepEqual(parseNotification(fixture), {
    topic: "orders_v2",
    resource: "/orders/2195160686",
    userId: 468424240,
    applicationId: 5503910054141466,
    attempts: 1,
    sentAt: "2019-10-30T16:19:20.129Z",
    actions: [],
  });
});

Deno.test("parseNotification aceita subtópicos em actions e ids como texto", () => {
  const parsed = parseNotification({
    ...fixture,
    topic: "messages",
    resource: "3f6da1e35ac84f70a24af7360d24c7bc",
    user_id: "123456789",
    actions: ["created", 7],
  });
  assert.equal(parsed.userId, 123456789);
  assert.deepEqual(parsed.actions, ["created"]);
});

Deno.test("parseNotification rejeita payload fora do contrato", () => {
  const invalid: unknown[] = [
    null,
    [],
    "texto",
    { ...fixture, topic: "payments" },
    { ...fixture, resource: "" },
    { ...fixture, resource: "/orders/1 drop" },
    { ...fixture, resource: "/".repeat(301) },
    { ...fixture, user_id: -1 },
    { ...fixture, user_id: "12a" },
    { ...fixture, application_id: undefined },
    { ...fixture, sent: "ontem" },
  ];
  for (const body of invalid) assert.throws(() => parseNotification(body), ContractError);
});

Deno.test("parseNotification usa 1 tentativa quando attempts é inválido", () => {
  assert.equal(parseNotification({ ...fixture, attempts: "x" }).attempts, 1);
});

Deno.test("isNotificationSource aceita apenas IPs publicados pelo Mercado Livre", () => {
  assert.equal(isNotificationSource("44.212.211.213"), true);
  assert.equal(isNotificationSource(" 35.186.182.146 "), true);
  assert.equal(isNotificationSource("8.8.8.8"), false);
  assert.equal(isNotificationSource(null), false);
});

Deno.test("clientIp usa o primeiro endereço de x-forwarded-for", () => {
  assert.equal(
    clientIp(new Headers({ "x-forwarded-for": "44.212.211.213, 10.0.0.1" })),
    "44.212.211.213",
  );
  assert.equal(clientIp(new Headers()), null);
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "" })), null);
});
