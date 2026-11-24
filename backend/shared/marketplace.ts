export const ORDER_STATUSES = [
  "confirmed",
  "payment_required",
  "payment_in_process",
  "partially_paid",
  "paid",
  "partially_refunded",
  "pending_cancel",
  "cancelled",
  "invalid",
] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];
