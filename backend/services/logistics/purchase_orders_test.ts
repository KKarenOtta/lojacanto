import assert from "node:assert/strict";
import {
  canTransitionPurchase,
  PURCHASE_ORDER_STATES,
  purchaseDispatch,
  type PurchaseOrderState,
  requiresHumanApproval,
} from "./purchase_orders.ts";

const allowed = new Set([
  "draft>awaiting_approval",
  "draft>cancelled",
  "awaiting_approval>sent",
  "awaiting_approval>cancelled",
  "sent>confirmed",
  "sent>rejected",
  "sent>cancelled",
  "confirmed>dispatched",
  "confirmed>cancelled",
]);

Deno.test("matriz completa de transições do pedido de compra", () => {
  for (const from of PURCHASE_ORDER_STATES) {
    for (const to of PURCHASE_ORDER_STATES) {
      assert.equal(
        canTransitionPurchase(from, to),
        allowed.has(`${from}>${to}`),
        `${from} -> ${to}`,
      );
    }
  }
});

Deno.test("só o envio ao fornecedor exige aprovação humana", () => {
  const approvals: string[] = [];
  for (const from of PURCHASE_ORDER_STATES) {
    for (const to of PURCHASE_ORDER_STATES) {
      if (requiresHumanApproval(from as PurchaseOrderState, to as PurchaseOrderState)) {
        approvals.push(`${from}>${to}`);
      }
    }
  }
  assert.deepEqual(approvals, ["awaiting_approval>sent"]);
});

Deno.test("pedido em plataforma ou manual vira tarefa da dona", () => {
  assert.equal(purchaseDispatch("platform"), "owner_task");
  assert.equal(purchaseDispatch("manual"), "owner_task");
  assert.equal(purchaseDispatch("email"), "email");
  assert.equal(purchaseDispatch("api"), "api");
});
