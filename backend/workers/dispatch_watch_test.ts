import assert from "node:assert/strict";
import type { ShipmentSla } from "../integrations/mercadolivre/fulfillment.ts";
import type { Alert } from "../integrations/telegram/alerts.ts";
import { createLogger } from "../shared/log.ts";
import {
  type DispatchCandidate,
  type DispatchDeps,
  type DispatchRecord,
  watchDispatch,
} from "./dispatch_watch.ts";

function candidate(overrides: Partial<DispatchCandidate> = {}): DispatchCandidate {
  return {
    order_id: "o1",
    marketplace_account_id: "a1",
    external_id: 2000000483899592,
    shipping_id: 43000000001,
    alert_level: "ok",
    ...overrides,
  };
}

function setup(
  candidates: DispatchCandidate[],
  sla: (id: string) => Promise<ShipmentSla>,
  killSwitch = false,
) {
  const records: Array<{ orderId: string } & DispatchRecord> = [];
  const alerts: Alert[] = [];
  const deps: DispatchDeps = {
    killSwitchActive: () => Promise.resolve(killSwitch),
    candidates: () => Promise.resolve(candidates),
    sla: (_account, shipment) => sla(shipment),
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
    now: () => new Date("2026-12-01T12:00:00Z"),
  };
  return { deps, records, alerts };
}

const sla = (
  expectedAt: string | null,
  status: ShipmentSla["status"] = "on_time",
): ShipmentSla => ({
  status,
  expectedAt,
  lastUpdated: "2026-12-01T11:00:00Z",
});

Deno.test("prazo distante é registrado sem alerta", async () => {
  const { deps, records, alerts } = setup(
    [candidate()],
    () => Promise.resolve(sla("2026-12-02T23:59:59Z")),
  );
  assert.deepEqual(await watchDispatch(deps), { halted: false, checked: 1, failed: 0, alerted: 0 });
  assert.deepEqual(records, [{
    orderId: "o1",
    slaStatus: "on_time",
    expectedAt: "2026-12-02T23:59:59Z",
    alertLevel: "ok",
  }]);
  assert.equal(alerts.length, 0);
});

Deno.test("alerta só quando o nível muda e atraso vira crítico", async () => {
  const { deps, alerts } = setup(
    [
      candidate({ order_id: "perto", shipping_id: 1 }),
      candidate({ order_id: "ja-avisado", shipping_id: 1, alert_level: "critical" }),
      candidate({ order_id: "atrasado", shipping_id: 3 }),
    ],
    (id) =>
      Promise.resolve(
        id === "3" ? sla("2026-12-01T10:00:00Z", "delayed") : sla("2026-12-01T14:00:00Z"),
      ),
  );
  assert.equal((await watchDispatch(deps)).alerted, 2);
  assert.deepEqual(alerts.map((a) => [a.severity, a.title]), [
    ["critical", "Despacho perto do limite"],
    ["critical", "Despacho atrasado"],
  ]);
});

Deno.test("falha na consulta não interrompe o lote e kill switch para tudo", async () => {
  const { deps, records } = setup(
    [candidate({ shipping_id: 1 }), candidate({ order_id: "o2", shipping_id: 2 })],
    (id) =>
      id === "1"
        ? Promise.reject(new Error("HTTP 500"))
        : Promise.resolve(sla(null, "insuficient_info")),
  );
  assert.deepEqual(await watchDispatch(deps), { halted: false, checked: 1, failed: 1, alerted: 0 });
  assert.deepEqual(records.map((r) => [r.orderId, r.alertLevel]), [["o2", "ok"]]);
  const halted = setup([candidate()], () => Promise.resolve(sla(null)), true);
  assert.equal((await watchDispatch(halted.deps)).halted, true);
});
