import { ContractError } from "../../shared/errors.ts";

export const SLA_STATUSES = ["on_time", "delayed", "early", "insuficient_info"] as const;
export type SlaStatus = typeof SLA_STATUSES[number];

export interface ShipmentSla {
  status: SlaStatus;
  expectedAt: string | null;
  lastUpdated: string;
}

export const DCE_STATUSES = ["pending", "completed", "error"] as const;
export type DceStatus = typeof DCE_STATUSES[number];

export interface DceInfo {
  status: DceStatus;
  documents: Array<{ key: string; status: string; errorCode: string | null }>;
}

const NUMERIC_ID = /^\d{1,20}$/;

function id(value: string, name: string): string {
  if (!NUMERIC_ID.test(value)) throw new RangeError(`invalid ${name}`);
  return value;
}

export const shipmentSlaPath = (shipmentId: string) =>
  `/shipments/${id(shipmentId, "shipment id")}/sla`;
export const dceEmissionPath = (orderId: string) =>
  `/mlb/order/${id(orderId, "order id")}/dce/emission`;
export const dceInfoPath = (orderId: string) => `/mlb/order/${id(orderId, "order id")}/dce/info`;

function instant(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ContractError(path, "invalid date");
  }
  return new Date(value).toISOString();
}

export function mapShipmentSla(raw: unknown): ShipmentSla {
  const body = raw as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new ContractError("sla", "expected an object");
  if (!(SLA_STATUSES as readonly unknown[]).includes(body.status)) {
    throw new ContractError("sla.status", "unknown status");
  }
  return {
    status: body.status as SlaStatus,
    expectedAt: body.expected_date === null || body.expected_date === undefined
      ? null
      : instant(body.expected_date, "sla.expected_date"),
    lastUpdated: instant(body.last_updated, "sla.last_updated"),
  };
}

export function mapDceInfo(raw: unknown): DceInfo {
  const body = raw as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new ContractError("dce", "expected an object");
  if (!(DCE_STATUSES as readonly unknown[]).includes(body.status)) {
    throw new ContractError("dce.status", "unknown status");
  }
  if (!Array.isArray(body.documents)) throw new ContractError("dce.documents", "expected an array");
  return {
    status: body.status as DceStatus,
    documents: body.documents.map((entry, index) => {
      const document = entry as Record<string, unknown> | null;
      const key = document?.dce_key;
      if (typeof key !== "string" || key.length === 0) {
        throw new ContractError(`dce.documents[${index}].dce_key`, "missing key");
      }
      const code = (document?.error as Record<string, unknown> | undefined)?.code;
      return {
        key,
        status: String(document?.status ?? ""),
        errorCode: typeof code === "string" && code.length > 0 ? code : null,
      };
    }),
  };
}
