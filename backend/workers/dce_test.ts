import assert from "node:assert/strict";
import type { Alert } from "../integrations/telegram/alerts.ts";
import type { DceInfo } from "../integrations/mercadolivre/fulfillment.ts";
import { createLogger } from "../shared/log.ts";
import { type DceCandidate, type DceDeps, type DceRecord, processDce } from "./dce.ts";

function candidate(overrides: Partial<DceCandidate> = {}): DceCandidate {
  return {
    order_id: "o1",
    marketplace_account_id: "a1",
    external_id: 2000000483899592,
    ordered_at: "2026-12-01T12:00:00Z",
    status: null,
    alert_level: "ok",
    emitter: "pulso",
    ...overrides,
  };
}

function setup(options: {
  candidates: DceCandidate[];
  info?: DceInfo;
  now?: string;
  emitFails?: boolean;
  killSwitch?: boolean;
}) {
  const records: Array<{ orderId: string } & DceRecord> = [];
  const alerts: Alert[] = [];
  const emitted: string[] = [];
  const deps: DceDeps = {
    killSwitchActive: () => Promise.resolve(options.killSwitch ?? false),
    candidates: () => Promise.resolve(options.candidates),
    emit: (_account, orderId) => {
      if (options.emitFails) return Promise.reject(new Error("HTTP 500"));
      emitted.push(orderId);
      return Promise.resolve("94e95c5fc1356f8e4c2bf779dce40000");
    },
    info: () => Promise.resolve(options.info ?? { status: "pending", documents: [] }),
    record: (orderId, record) => {
      records.push({ orderId, ...record });
      return Promise.resolve();
    },
    alerts: {
      send: (alert) => {
        alerts.push(alert);
        return Promise.resolve(true);
      },
    },
    logger: createLogger({}, () => {}),
    now: () => new Date(options.now ?? "2026-12-01T13:00:00Z"),
  };
  return { deps, records, alerts, emitted };
}

Deno.test("pedido novo dispara a emissão da DC-e uma vez", async () => {
  const { deps, records, emitted, alerts } = setup({ candidates: [candidate()] });
  assert.equal((await processDce(deps)).requested, 1);
  assert.deepEqual(emitted, ["2000000483899592"]);
  assert.deepEqual(records, [{
    orderId: "o1",
    status: "requested",
    coverageId: "94e95c5fc1356f8e4c2bf779dce40000",
  }]);
  assert.equal(alerts.length, 0);
});

Deno.test("emissão concluída grava a chave do documento sem alerta", async () => {
  const { deps, records, alerts } = setup({
    candidates: [candidate({ status: "requested" })],
    info: {
      status: "completed",
      documents: [{ key: "doc-789", status: "issued", errorCode: null }],
    },
    now: "2026-12-04T00:00:00Z",
  });
  assert.equal((await processDce(deps)).completed, 1);
  assert.equal(records[0]!.documentKey, "doc-789");
  assert.equal(alerts.length, 0);
});

Deno.test("erro na DC-e é registrado com o código", async () => {
  const { deps, records } = setup({
    candidates: [candidate({ status: "pending" })],
    info: { status: "error", documents: [{ key: "d", status: "rejected", errorCode: "E123" }] },
  });
  assert.equal((await processDce(deps)).failed, 1);
  assert.equal(records[0]!.errorCode, "E123");
});

Deno.test("alerta sobe de nível conforme o prazo de 3 dias e não se repete", async () => {
  const warning = setup({
    candidates: [candidate({ status: "pending" })],
    now: "2026-12-02T13:00:00Z",
  });
  await processDce(warning.deps);
  assert.equal(warning.alerts[0]!.severity, "warning");
  assert.equal(warning.records.at(-1)!.alertLevel, "warning");

  const repeated = setup({
    candidates: [candidate({ status: "pending", alert_level: "warning" })],
    now: "2026-12-02T13:00:00Z",
  });
  assert.equal((await processDce(repeated.deps)).alerted, 0);

  const overdue = setup({
    candidates: [candidate({ status: "pending", alert_level: "critical" })],
    now: "2026-12-04T12:00:00Z",
  });
  await processDce(overdue.deps);
  assert.equal(overdue.alerts[0]!.severity, "critical");
  assert.match(overdue.alerts[0]!.title, /vencida/);
});

Deno.test("falha na emissão não interrompe o lote e ainda alerta pelo prazo", async () => {
  const { deps, alerts, records } = setup({
    candidates: [candidate()],
    emitFails: true,
    now: "2026-12-03T13:00:00Z",
  });
  const summary = await processDce(deps);
  assert.equal(summary.requested, 0);
  assert.equal(alerts[0]!.severity, "critical");
  assert.equal(records[0]!.status, "emission_failed");

  const retry = setup({ candidates: [candidate({ status: "emission_failed" })] });
  assert.equal((await processDce(retry.deps)).requested, 1);
  assert.equal(retry.emitted.length, 1);
});

Deno.test("kill switch interrompe antes de emitir", async () => {
  const { deps, emitted } = setup({ candidates: [candidate()], killSwitch: true });
  assert.equal((await processDce(deps)).halted, true);
  assert.equal(emitted.length, 0);
});

Deno.test("DC-e emitida pela plataforma é só acompanhada, nunca emitida pelo Pulso", async () => {
  const { deps, emitted, records, alerts } = setup({
    candidates: [candidate({ emitter: "platform" })],
    now: "2026-12-03T20:00:00Z",
  });
  await processDce(deps);
  assert.deepEqual(emitted, []);
  assert.equal(records[0]!.status, "pending");
  assert.match(alerts[0]!.detail, /plataforma ainda não emitiu/);

  const done = setup({
    candidates: [candidate({ emitter: "platform" })],
    info: {
      status: "completed",
      documents: [{ key: "k1", status: "authorized", errorCode: null }],
    },
  });
  assert.equal((await processDce(done.deps)).completed, 1);
  assert.deepEqual(done.emitted, []);
});
