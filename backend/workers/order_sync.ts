import type { AlertSender } from "../integrations/telegram/alerts.ts";
import { mapOrder, type OrderSnapshot } from "../integrations/mercadolivre/orders.ts";
import { type OrderState, stateFromMarketplace } from "../services/orders/state.ts";
import { isNewer } from "../services/sync/freshness.ts";
import { AuthorizationError, ContractError, UpstreamError } from "../shared/errors.ts";
import type { Logger } from "../shared/log.ts";

export interface ClaimedEvent {
  msg_id: number;
  read_count: number;
  event_id: number;
  topic: string;
  resource: string;
  external_user_id: number;
  marketplace_account_id: string | null;
  correlation_id: string;
}

export type CompletionStatus = "processed" | "ignored" | "failed";
export type ApplyResult = "inserted" | "updated" | "stale" | "conflict";

export interface OrderVersion {
  state: OrderState;
  externalUpdatedAt: string;
}

export interface OrderSyncDeps {
  killSwitchActive: () => Promise<boolean>;
  claim: (batch: number) => Promise<ClaimedEvent[]>;
  complete: (event: ClaimedEvent, status: CompletionStatus, error?: string) => Promise<void>;
  fetchOrder: (accountId: string, orderId: string) => Promise<unknown>;
  currentOrder: (accountId: string, orderId: string) => Promise<OrderVersion | null>;
  applySnapshot: (
    accountId: string,
    record: Record<string, unknown>,
    expected: OrderState | null,
    next: OrderState,
  ) => Promise<ApplyResult>;
  alerts: AlertSender;
  logger: Logger;
  maxAttempts?: number;
}

export interface SyncSummary {
  halted: boolean;
  processed: number;
  ignored: number;
  retried: number;
  failed: number;
}

type Outcome = "processed" | "ignored" | "retry";

const ORDER_RESOURCE = /^\/orders\/(\d{1,20})$/;

export function toOrderRecord(order: OrderSnapshot): Record<string, unknown> {
  return {
    external_id: order.externalId,
    pack_id: order.packId,
    shipping_id: order.shippingId,
    status: order.status,
    status_detail: order.statusDetail,
    currency: order.currency,
    total_cents: order.totalCents,
    paid_cents: order.paidCents,
    is_test: order.isTest,
    created_at: order.createdAt,
    closed_at: order.closedAt,
    last_updated: order.lastUpdated,
    items: order.items.map((item) => ({
      item_id: item.itemId,
      variation_id: item.variationId,
      title: item.title,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      sale_fee_cents: item.saleFeeCents,
      listing_type_id: item.listingTypeId,
    })),
  };
}

async function syncOrder(
  deps: OrderSyncDeps,
  event: ClaimedEvent,
  accountId: string,
  orderId: string,
  log: Logger,
): Promise<Outcome> {
  const snapshot = mapOrder(await deps.fetchOrder(accountId, orderId));
  if (snapshot.sellerId !== String(event.external_user_id)) {
    throw new ContractError("order.seller.id", "does not match the notified seller");
  }
  const current = await deps.currentOrder(accountId, snapshot.externalId);
  if (current && !isNewer(current.externalUpdatedAt, snapshot.lastUpdated)) return "processed";

  const decision = stateFromMarketplace(current?.state ?? null, snapshot.status);
  if (decision.rejected) {
    log.warn("order.transition_rejected", {
      order_id: snapshot.externalId,
      state: current?.state,
      status: snapshot.status,
    });
  }
  const result = await deps.applySnapshot(
    accountId,
    toOrderRecord(snapshot),
    current?.state ?? null,
    decision.state,
  );
  log.info("order.synced", { order_id: snapshot.externalId, result, state: decision.state });
  return result === "conflict" ? "retry" : "processed";
}

export async function syncOrders(deps: OrderSyncDeps, batch = 10): Promise<SyncSummary> {
  const summary: SyncSummary = { halted: false, processed: 0, ignored: 0, retried: 0, failed: 0 };
  if (await deps.killSwitchActive()) {
    deps.logger.warn("sync.halted", { reason: "kill_switch" });
    return { ...summary, halted: true };
  }
  const maxAttempts = deps.maxAttempts ?? 5;

  for (const event of await deps.claim(batch)) {
    const log = deps.logger.child({
      correlation_id: event.correlation_id,
      event_id: event.event_id,
    });
    const orderId = ORDER_RESOURCE.exec(event.resource)?.[1];
    if (event.topic !== "orders_v2" || !orderId || !event.marketplace_account_id) {
      await deps.complete(event, "ignored");
      summary.ignored++;
      continue;
    }
    try {
      const outcome = await syncOrder(deps, event, event.marketplace_account_id, orderId, log);
      if (outcome === "retry" && event.read_count < maxAttempts) {
        summary.retried++;
        continue;
      }
      await deps.complete(event, "processed");
      summary.processed++;
    } catch (error) {
      const transient = (error instanceof UpstreamError && error.retryable) ||
        error instanceof AuthorizationError;
      if (transient && event.read_count < maxAttempts) {
        log.warn("order.sync_retry", { error, attempt: event.read_count });
        summary.retried++;
        continue;
      }
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
      log.error("order.sync_failed", { error });
      await deps.complete(event, "failed", reason);
      await deps.alerts.send({
        severity: error instanceof AuthorizationError ? "critical" : "warning",
        title: "Falha ao sincronizar pedido",
        detail: `Pedido ${orderId}: ${reason}`,
        correlationId: event.correlation_id,
      });
      summary.failed++;
    }
  }
  deps.logger.info("sync.completed", { ...summary });
  return summary;
}
