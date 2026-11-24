export const PURCHASE_ORDER_STATES = [
  "draft",
  "awaiting_approval",
  "sent",
  "confirmed",
  "dispatched",
  "rejected",
  "cancelled",
] as const;

export type PurchaseOrderState = typeof PURCHASE_ORDER_STATES[number];

const TRANSITIONS: Record<PurchaseOrderState, readonly PurchaseOrderState[]> = {
  draft: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["sent", "cancelled"],
  sent: ["confirmed", "rejected", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: [],
  rejected: [],
  cancelled: [],
};

export function canTransitionPurchase(from: PurchaseOrderState, to: PurchaseOrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function requiresHumanApproval(from: PurchaseOrderState, to: PurchaseOrderState): boolean {
  return from === "awaiting_approval" && to === "sent";
}
