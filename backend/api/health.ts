import { correlationId, json } from "../shared/http.ts";
import { createLogger, type Logger } from "../shared/log.ts";

export interface HealthDeps {
  version: string;
  now: () => Date;
  logger: Logger;
}

export function createHealthHandler(deps: HealthDeps): (request: Request) => Response {
  return (request) => {
    const id = correlationId(request);
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405, { allow: "GET", "x-correlation-id": id });
    }
    deps.logger.info("health.checked", { correlation_id: id });
    return json(
      { status: "ok", version: deps.version, time: deps.now().toISOString() },
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
  });
}
