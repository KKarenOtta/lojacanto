import type { AlertSender } from "../integrations/telegram/alerts.ts";
import type { DceInfo } from "../integrations/mercadolivre/fulfillment.ts";
import {
  dceDeadline,
  type DeadlineLevel,
  deadlineLevel,
  type DeadlinePolicy,
} from "../services/logistics/deadlines.ts";
import type { Logger } from "../shared/log.ts";

export interface DceCandidate {
  order_id: string;
  marketplace_account_id: string;
  external_id: number;
  ordered_at: string;
  status: "emission_failed" | "requested" | "pending" | "error" | null;
  alert_level: DeadlineLevel;
}

export interface DceRecord {
  status: "emission_failed" | "requested" | "pending" | "completed" | "error";
  coverageId?: string;
  documentKey?: string;
  errorCode?: string | null;
  alertLevel?: DeadlineLevel;
}

export interface DceDeps {
  killSwitchActive: () => Promise<boolean>;
  candidates: (limit: number) => Promise<DceCandidate[]>;
  emit: (accountId: string, orderId: string) => Promise<string>;
  info: (accountId: string, orderId: string) => Promise<DceInfo>;
  record: (orderId: string, record: DceRecord) => Promise<void>;
  alerts: AlertSender;
  logger: Logger;
  now: () => Date;
  policy?: DeadlinePolicy;
}

export interface DceSummary {
  halted: boolean;
  requested: number;
  completed: number;
  failed: number;
  alerted: number;
}

const DEFAULT_POLICY: DeadlinePolicy = { warningHours: 48, criticalHours: 24 };
const SEVERITY = { warning: "warning", critical: "critical", overdue: "critical" } as const;

async function advance(deps: DceDeps, candidate: DceCandidate): Promise<DceRecord["status"]> {
  const orderId = String(candidate.external_id);
  if (candidate.status === null || candidate.status === "emission_failed") {
    const coverageId = await deps.emit(candidate.marketplace_account_id, orderId);
    await deps.record(candidate.order_id, { status: "requested", coverageId });
    return "requested";
  }
  const info = await deps.info(candidate.marketplace_account_id, orderId);
  if (info.status === "completed") {
    await deps.record(candidate.order_id, {
      status: "completed",
      documentKey: info.documents[0]?.key,
      errorCode: null,
    });
    return "completed";
  }
  if (info.status === "error") {
    const errorCode = info.documents.find((document) => document.errorCode)?.errorCode ?? "unknown";
    await deps.record(candidate.order_id, { status: "error", errorCode });
    return "error";
  }
  await deps.record(candidate.order_id, { status: "pending" });
  return "pending";
}

export async function processDce(deps: DceDeps, batch = 20): Promise<DceSummary> {
  const summary: DceSummary = { halted: false, requested: 0, completed: 0, failed: 0, alerted: 0 };
  if (await deps.killSwitchActive()) return { ...summary, halted: true };
  const policy = deps.policy ?? DEFAULT_POLICY;

  for (const candidate of await deps.candidates(batch)) {
    const log = deps.logger.child({ order_id: candidate.external_id });
    let status: DceRecord["status"];
    try {
      status = await advance(deps, candidate);
    } catch (error) {
      log.error("dce.failed", { error });
      status = candidate.status === null || candidate.status === "emission_failed"
        ? "emission_failed"
        : candidate.status;
    }
    if (status === "requested") summary.requested++;
    if (status === "completed") {
      summary.completed++;
      continue;
    }
    if (status === "error") summary.failed++;

    const deadline = dceDeadline(candidate.ordered_at);
    const level = deadlineLevel(deadline, deps.now(), policy);
    if (level === "ok" || level === candidate.alert_level) continue;
    await deps.alerts.send({
      severity: SEVERITY[level],
      title: level === "overdue" ? "DC-e vencida: pedido será cancelado" : "DC-e pendente",
      detail: `Pedido ${candidate.external_id}: emitir até ${deadline} (situação: ${status}).`,
    });
    await deps.record(candidate.order_id, { status, alertLevel: level });
    summary.alerted++;
  }
  deps.logger.info("dce.completed", { ...summary });
  return summary;
}
