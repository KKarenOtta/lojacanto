import { correlationId, json } from "../shared/http.ts";
import { createLogger, type Logger } from "../shared/log.ts";

export type CheckStatus = "ok" | "missing" | "invalid_token" | "invalid_chat_id";

export interface HealthDeps {
  version: string;
  now: () => Date;
  logger: Logger;
  alertChannel: CheckStatus;
}

export function alertChannelStatus(env: Pick<typeof Deno.env, "get">): CheckStatus {
  const token = env.get("TELEGRAM_BOT_TOKEN");
  const chatId = env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return "missing";
  if (!/^\d+:[\w-]+$/.test(token)) return "invalid_token";
  return /^-?\d+$/.test(chatId) ? "ok" : "invalid_chat_id";
}

export function createHealthHandler(deps: HealthDeps): (request: Request) => Response {
  return (request) => {
    const id = correlationId(request);
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405, { allow: "GET", "x-correlation-id": id });
    }
    const checks = { alert_channel: deps.alertChannel };
    const status = Object.values(checks).every((check) => check === "ok") ? "ok" : "degraded";
    deps.logger.info("health.checked", { correlation_id: id, status, checks });
    return json(
      { status, version: deps.version, time: deps.now().toISOString(), checks },
      200,
      { "x-correlation-id": id },
    );
  };
}

export function defaultHealthHandler(): (request: Request) => Response {
  return createHealthHandler({
    version: Deno.env.get("APP_VERSION") ?? "dev",
    now: () => new Date(),
    logger: createLogger({ service: "health" }),
    alertChannel: alertChannelStatus(Deno.env),
  });
}
