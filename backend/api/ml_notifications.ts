import { createRpc } from "../integrations/supabase/rpc.ts";
import {
  clientIp,
  isNotificationSource,
  type Notification,
  parseNotification,
} from "../integrations/mercadolivre/notifications.ts";
import { ContractError } from "../shared/errors.ts";
import { correlationId, json } from "../shared/http.ts";
import { createLogger, type Logger } from "../shared/log.ts";

const MAX_BODY_BYTES = 8_192;

export interface NotificationDeps {
  applicationId: number | null;
  enqueue: (notification: Notification, correlationId: string) => Promise<boolean>;
  logger: Logger;
  trustSource?: (ip: string | null) => boolean;
}

export function createNotificationHandler(
  deps: NotificationDeps,
): (request: Request) => Promise<Response> {
  const trustSource = deps.trustSource ?? isNotificationSource;
  return async (request) => {
    const id = correlationId(request);
    const headers = { "x-correlation-id": id };
    const log = deps.logger.child({ correlation_id: id });

    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, { ...headers, allow: "POST" });
    }
    if (deps.applicationId === null) {
      log.error("notification.not_configured");
      return json({ error: "not_configured" }, 503, headers);
    }
    const ip = clientIp(request.headers);
    if (!trustSource(ip)) {
      log.warn("notification.untrusted_source", { ip });
      return json({ error: "forbidden" }, 403, headers);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413, headers);

    let notification: Notification;
    try {
      notification = parseNotification(JSON.parse(raw));
    } catch (error) {
      const path = error instanceof ContractError ? error.path : "body";
      log.warn("notification.ignored", { reason: "invalid", path });
      return json({ status: "ignored" }, 200, headers);
    }
    if (notification.applicationId !== deps.applicationId) {
      log.warn("notification.ignored", { reason: "foreign_application" });
      return json({ status: "ignored" }, 200, headers);
    }

    try {
      const queued = await deps.enqueue(notification, id);
      log.info("notification.received", {
        topic: notification.topic,
        resource: notification.resource,
        attempts: notification.attempts,
        queued,
      });
      return json({ status: queued ? "queued" : "duplicate" }, 200, headers);
    } catch (error) {
      log.error("notification.enqueue_failed", { error });
      return json({ error: "unavailable" }, 503, headers);
    }
  };
}

export function defaultNotificationHandler(): (request: Request) => Promise<Response> {
  const rpc = createRpc({
    url: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  });
  const appId = Number(Deno.env.get("ML_APP_ID"));
  return createNotificationHandler({
    applicationId: Number.isSafeInteger(appId) && appId > 0 ? appId : null,
    logger: createLogger({ service: "ml-notifications" }),
    enqueue: (n, id) =>
      rpc<boolean>("enqueue_marketplace_notification", {
        p_topic: n.topic,
        p_resource: n.resource,
        p_external_user_id: n.userId,
        p_application_id: n.applicationId,
        p_attempts: n.attempts,
        p_sent_at: n.sentAt,
        p_correlation_id: id,
      }),
  });
}
