import type { ShipmentSla } from "../integrations/mercadolivre/fulfillment.ts";
import type { AlertSender } from "../integrations/telegram/alerts.ts";
import {
  type DeadlineLevel,
  deadlineLevel,
  type DeadlinePolicy,
} from "../services/logistics/deadlines.ts";
import type { Logger } from "../shared/log.ts";

export interface DispatchCandidate {
  order_id: string;
  marketplace_account_id: string;
  external_id: number;
  shipping_id: number;
  alert_level: DeadlineLevel;
}

export interface DispatchRecord {
  slaStatus: ShipmentSla["status"];
  expectedAt: string | null;
  alertLevel: DeadlineLevel;
}

export interface DispatchDeps {
  killSwitchActive: () => Promise<boolean>;
  candidates: (limit: number) => Promise<DispatchCandidate[]>;
  sla: (accountId: string, shipmentId: string) => Promise<ShipmentSla>;
  record: (orderId: string, record: DispatchRecord) => Promise<void>;
  alerts: AlertSender;
  logger: Logger;
  now: () => Date;
  policy?: DeadlinePolicy;
}

export interface DispatchSummary {
  halted: boolean;
  checked: number;
  failed: number;
  alerted: number;
}

const DEFAULT_POLICY: DeadlinePolicy = { warningHours: 12, criticalHours: 4 };
const SEVERITY = { warning: "warning", critical: "critical", overdue: "critical" } as const;

export async function watchDispatch(deps: DispatchDeps, batch = 50): Promise<DispatchSummary> {
  const summary: DispatchSummary = { halted: false, checked: 0, failed: 0, alerted: 0 };
  if (await deps.killSwitchActive()) return { ...summary, halted: true };
  const policy = deps.policy ?? DEFAULT_POLICY;

  for (const candidate of await deps.candidates(batch)) {
    const log = deps.logger.child({ order_id: candidate.external_id });
    let sla: ShipmentSla;
    try {
      sla = await deps.sla(candidate.marketplace_account_id, String(candidate.shipping_id));
    } catch (error) {
      log.error("dispatch.sla_failed", { error });
      summary.failed++;
      continue;
    }
    summary.checked++;
    const level: DeadlineLevel = sla.status === "delayed"
      ? "overdue"
      : sla.expectedAt === null
      ? "ok"
      : deadlineLevel(sla.expectedAt, deps.now(), policy);
    const changed = level !== candidate.alert_level;
    if (changed && level !== "ok") {
      await deps.alerts.send({
        severity: SEVERITY[level],
        title: level === "overdue" ? "Despacho atrasado" : "Despacho perto do limite",
        detail: `Pedido ${candidate.external_id}: despachar até ${
          sla.expectedAt ?? "data não informada"
        } (situação: ${sla.status}).`,
      });
      summary.alerted++;
    }
    await deps.record(candidate.order_id, {
      slaStatus: sla.status,
      expectedAt: sla.expectedAt,
      alertLevel: level,
    });
  }
  deps.logger.info("dispatch.completed", { ...summary });
  return summary;
}
