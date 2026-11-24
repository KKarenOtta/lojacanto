import assert from "node:assert/strict";
import { ORDER_STATUSES } from "../../shared/marketplace.ts";
import { canTransition, ORDER_STATES, type OrderState, stateFromMarketplace } from "./state.ts";

const VALID: Array<[OrderState, OrderState]> = [
  ["received", "awaiting_supplier"],
  ["received", "cancelled"],
  ["awaiting_supplier", "supplier_confirmed"],
  ["awaiting_supplier", "problem"],
  ["awaiting_supplier", "cancelled"],
  ["supplier_confirmed", "ready_to_ship"],
  ["supplier_confirmed", "problem"],
  ["supplier_confirmed", "cancelled"],
  ["ready_to_ship", "shipped"],
  ["ready_to_ship", "problem"],
  ["ready_to_ship", "cancelled"],
  ["shipped", "delivered"],
  ["shipped", "problem"],
  ["delivered", "returned"],
  ["problem", "awaiting_supplier"],
  ["problem", "cancelled"],
];

Deno.test("canTransition aceita exatamente as transições do modelo de domínio", () => {
  const valid = new Set(VALID.map(([from, to]) => `${from}>${to}`));
  for (const from of ORDER_STATES) {
    for (const to of ORDER_STATES) {
      assert.equal(canTransition(from, to), valid.has(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
});

Deno.test("pedido novo assume o estado conforme o status do marketplace", () => {
  const expected: Record<string, OrderState> = {
    confirmed: "received",
    payment_required: "received",
    payment_in_process: "received",
    partially_paid: "received",
    paid: "awaiting_supplier",
    partially_refunded: "problem",
    pending_cancel: "cancelled",
    cancelled: "cancelled",
    invalid: "cancelled",
  };
  for (const status of ORDER_STATUSES) {
    assert.deepEqual(stateFromMarketplace(null, status), {
      state: expected[status],
      changed: true,
      rejected: false,
    });
  }
});

Deno.test("pagamento move received para awaiting_supplier", () => {
  assert.deepEqual(stateFromMarketplace("received", "paid"), {
    state: "awaiting_supplier",
    changed: true,
    rejected: false,
  });
});

Deno.test("status paid repetido não regride estados operacionais", () => {
  for (const current of ["supplier_confirmed", "ready_to_ship", "shipped"] as const) {
    assert.deepEqual(stateFromMarketplace(current, "paid"), {
      state: current,
      changed: false,
      rejected: false,
    });
  }
});

Deno.test("status sem pagamento após pagamento é rejeitado sem alterar o estado", () => {
  assert.deepEqual(stateFromMarketplace("awaiting_supplier", "payment_in_process"), {
    state: "awaiting_supplier",
    changed: false,
    rejected: true,
  });
});

Deno.test("cancelamento e reembolso parcial seguem as transições permitidas", () => {
  assert.deepEqual(stateFromMarketplace("awaiting_supplier", "cancelled"), {
    state: "cancelled",
    changed: true,
    rejected: false,
  });
  assert.deepEqual(stateFromMarketplace("ready_to_ship", "partially_refunded"), {
    state: "problem",
    changed: true,
    rejected: false,
  });
  assert.deepEqual(stateFromMarketplace("delivered", "cancelled"), {
    state: "delivered",
    changed: false,
    rejected: true,
  });
});

Deno.test("mesmo estado não gera mudança", () => {
  assert.deepEqual(stateFromMarketplace("cancelled", "cancelled"), {
    state: "cancelled",
    changed: false,
    rejected: false,
  });
});
