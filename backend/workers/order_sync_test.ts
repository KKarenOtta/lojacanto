import assert from "node:assert/strict";
import type { Alert } from "../integrations/telegram/alerts.ts";
import { AuthorizationError, UpstreamError } from "../shared/errors.ts";
import { createLogger } from "../shared/log.ts";
import {
  type ApplyResult,
  type ClaimedEvent,
  type CompletionStatus,
  type OrderSyncDeps,
  type OrderVersion,
  syncOrders,
} from "./order_sync.ts";

const order = JSON.parse(
  await Deno.readTextFile(
    new URL("../integrations/mercadolivre/fixtures/order_paid.json", import.meta.url),
  ),
);

const ACCOUNT = "30000000-0000-0000-0000-00000000000d";

function event(overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
  return {
    msg_id: 1,
    read_count: 1,
    event_id: 10,
    topic: "orders_v2",
    resource: "/orders/2000003508897196",
    external_user_id: 478055419,
    marketplace_account_id: ACCOUNT,
    correlation_id: "20000000-0000-0000-0000-000000000001",
    ...overrides,
  };
}

function setup(options: {
  events: ClaimedEvent[];
  fetchOrder?: () => Promise<unknown>;
  current?: OrderVersion | null;
  apply?: ApplyResult;
  killSwitch?: boolean;
}) {
  const completed: Array<{ id: number; status: CompletionStatus; error?: string }> = [];
  const applied: Array<{ expected: string | null; next: string; record: Record<string, unknown> }> =
    [];
  const alerts: Alert[] = [];
  const deps: OrderSyncDeps = {
    killSwitchActive: () => Promise.resolve(options.killSwitch ?? false),
    claim: () => Promise.resolve(options.events),
    complete: (e, status, error) => {
      completed.push({ id: e.event_id, status, error });
      return Promise.resolve();
    },
    fetchOrder: options.fetchOrder ?? (() => Promise.resolve(order)),
    currentOrder: () => Promise.resolve(options.current ?? null),
    applySnapshot: (_account, record, expected, next) => {
      applied.push({ record, expected, next });
      return Promise.resolve(options.apply ?? "inserted");
    },
    alerts: {
      send: (alert) => {
        alerts.push(alert);
        return Promise.resolve(true);
      },
    },
    logger: createLogger({}, () => {}),
    maxAttempts: 3,
  };
  return { deps, completed, applied, alerts };
}

Deno.test("pedido pago novo é gravado aguardando fornecedor", async () => {
  const { deps, completed, applied } = setup({ events: [event()] });
  const summary = await syncOrders(deps);
  assert.equal(summary.processed, 1);
  assert.deepEqual(completed, [{ id: 10, status: "processed", error: undefined }]);
  assert.equal(applied[0]!.expected, null);
  assert.equal(applied[0]!.next, "awaiting_supplier");
  assert.equal(applied[0]!.record.total_cents, 5000);
  assert.equal(applied[0]!.record.external_id, "2000003508897196");
});

Deno.test("versão igual ou mais antiga não é reaplicada", async () => {
  const { deps, applied, completed } = setup({
    events: [event()],
    current: { state: "shipped", externalUpdatedAt: "2099-01-01T00:00:00.000Z" },
  });
  await syncOrders(deps);
  assert.equal(applied.length, 0);
  assert.equal(completed[0]!.status, "processed");
});

Deno.test("tópico não tratado, recurso fora do padrão ou conta inativa são ignorados", async () => {
  const { deps, completed } = setup({
    events: [
      event({ event_id: 1, topic: "questions" }),
      event({ event_id: 2, resource: "/orders/abc" }),
      event({ event_id: 3, marketplace_account_id: null }),
    ],
  });
  const summary = await syncOrders(deps);
  assert.equal(summary.ignored, 3);
  assert.ok(completed.every((c) => c.status === "ignored"));
});

Deno.test("kill switch interrompe antes de consumir a fila", async () => {
  let claimed = false;
  const { deps } = setup({ events: [event()], killSwitch: true });
  deps.claim = () => {
    claimed = true;
    return Promise.resolve([]);
  };
  assert.equal((await syncOrders(deps)).halted, true);
  assert.equal(claimed, false);
});

Deno.test("erro transitório e conflito ficam para nova tentativa dentro do limite", async () => {
  const transient = setup({
    events: [event()],
    fetchOrder: () => Promise.reject(new UpstreamError(503, true, "HTTP 503")),
  });
  assert.equal((await syncOrders(transient.deps)).retried, 1);
  assert.equal(transient.completed.length, 0);

  const conflict = setup({ events: [event()], apply: "conflict" });
  assert.equal((await syncOrders(conflict.deps)).retried, 1);
  assert.equal(conflict.completed.length, 0);
});

Deno.test("esgotadas as tentativas o evento falha e gera alerta", async () => {
  const { deps, completed, alerts } = setup({
    events: [event({ read_count: 3 })],
    fetchOrder: () => Promise.reject(new AuthorizationError("unauthorized on /orders/1")),
  });
  assert.equal((await syncOrders(deps)).failed, 1);
  assert.equal(completed[0]!.status, "failed");
  assert.equal(alerts[0]!.severity, "critical");
});

Deno.test("contrato inválido ou vendedor divergente falha sem nova tentativa", async () => {
  const invalid = setup({ events: [event()], fetchOrder: () => Promise.resolve({ id: "x" }) });
  assert.equal((await syncOrders(invalid.deps)).failed, 1);
  assert.equal(invalid.alerts[0]!.severity, "warning");

  const foreign = setup({ events: [event({ external_user_id: 1 })] });
  assert.equal((await syncOrders(foreign.deps)).failed, 1);
  assert.match(foreign.completed[0]!.error!, /seller/);
});

Deno.test("conflito persistente após o limite é concluído", async () => {
  const { deps, completed } = setup({ events: [event({ read_count: 3 })], apply: "conflict" });
  assert.equal((await syncOrders(deps)).processed, 1);
  assert.equal(completed[0]!.status, "processed");
});
