import type { OrderStatus } from "../../shared/marketplace.ts";

export const ORDER_STATES = [
  "received",
  "awaiting_supplier",
  "supplier_confirmed",
  "ready_to_ship",
  "shipped",
  "delivered",
  "problem",
  "cancelled",
  "returned",
] as const;

export type OrderState = typeof ORDER_STATES[number];

const TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  received: ["awaiting_supplier", "cancelled"],
  awaiting_supplier: ["supplier_confirmed", "problem", "cancelled"],
  supplier_confirmed: ["ready_to_ship", "problem", "cancelled"],
  ready_to_ship: ["shipped", "problem", "cancelled"],
  shipped: ["delivered", "problem"],
  delivered: ["returned"],
  problem: ["awaiting_supplier", "cancelled"],
  cancelled: [],
  returned: [],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

const UNPAID: readonly OrderStatus[] = [
  "confirmed",
  "payment_required",
  "payment_in_process",
  "partially_paid",
];
const CANCELLED: readonly OrderStatus[] = ["cancelled", "invalid", "pending_cancel"];

export interface StateDecision {
  state: OrderState;
  changed: boolean;
  rejected: boolean;
}

export function stateFromMarketplace(
  current: OrderState | null,
  status: OrderStatus,
): StateDecision {
  const target: OrderState = CANCELLED.includes(status)
    ? "cancelled"
    : status === "partially_refunded"
    ? "problem"
    : status === "paid"
    ? "awaiting_supplier"
    : "received";

  if (current === null) {
    return { state: UNPAID.includes(status) ? "received" : target, changed: true, rejected: false };
  }
  if (current === target) return { state: current, changed: false, rejected: false };
  if (status === "paid" && current !== "received") {
    return { state: current, changed: false, rejected: false };
  }
  if (UNPAID.includes(status) && current !== "received") {
    return { state: current, changed: false, rejected: true };
  }
  return canTransition(current, target)
    ? { state: target, changed: true, rejected: false }
    : { state: current, changed: false, rejected: true };
}
