import type { Logger } from "../../shared/log.ts";

export type Severity = "critical" | "warning" | "info";

export interface Alert {
  severity: Severity;
  title: string;
  detail: string;
  correlationId?: string;
}

export interface AlertSender {
  send(alert: Alert): Promise<boolean>;
}

export interface TelegramConfig {
  token: string;
  chatId: string;
  logger: Logger;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const LABEL: Record<Severity, string> = {
  critical: "CRÍTICO",
  warning: "ATENÇÃO",
  info: "INFO",
};
const MAX_LENGTH = 1_000;

export function formatAlert(alert: Alert): string {
  const lines = [`[${LABEL[alert.severity]}] ${alert.title}`, alert.detail];
  if (alert.correlationId) lines.push(`ref: ${alert.correlationId}`);
  const text = lines.join("\n");
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

export function createTelegramAlerter(config: TelegramConfig): AlertSender {
  const doFetch = config.fetch ?? fetch;
  return {
    async send(alert) {
      try {
        const response = await doFetch(
          `https://api.telegram.org/bot${config.token}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: config.chatId,
              text: formatAlert(alert),
              disable_web_page_preview: true,
            }),
            signal: AbortSignal.timeout(config.timeoutMs ?? 5_000),
          },
        );
        await response.body?.cancel();
        if (!response.ok) {
          config.logger.error("alert.failed", { status: response.status, title: alert.title });
          return false;
        }
        config.logger.info("alert.sent", { severity: alert.severity, title: alert.title });
        return true;
      } catch (error) {
        config.logger.error("alert.failed", { error, title: alert.title });
        return false;
      }
    },
  };
}
