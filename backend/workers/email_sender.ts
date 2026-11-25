import type { AccessToken } from "../integrations/email/google_oauth.ts";
import type { OutgoingEmail } from "../integrations/email/gmail.ts";
import type { AlertSender } from "../integrations/telegram/alerts.ts";
import { AuthorizationError, UpstreamError } from "../shared/errors.ts";
import type { Logger } from "../shared/log.ts";

export interface ClaimedMessage {
  id: string;
  store_id: string;
  sender_id: string;
  sender_address: string;
  recipient: string;
  subject: string;
  body: string;
  in_reply_to: string | null;
  attempts: number;
}

export type Outcome = "sent" | "retry" | "failed";

export interface EmailSenderDeps {
  claim: (limit: number) => Promise<ClaimedMessage[]>;
  refreshToken: (storeId: string, address: string) => Promise<string | null>;
  accessToken: (refreshToken: string) => Promise<AccessToken>;
  send: (accessToken: string, email: OutgoingEmail) => Promise<string>;
  complete: (id: string, outcome: Outcome, providerId?: string, error?: string) => Promise<void>;
  markReauthorization: (senderId: string) => Promise<void>;
  alerts: AlertSender;
  logger: Logger;
  now: () => Date;
}

export interface EmailSenderSummary {
  sent: number;
  retried: number;
  failed: number;
  reauthorization: number;
}

const EXPIRY_MARGIN_MS = 60_000;

export async function sendOutboundMessages(
  deps: EmailSenderDeps,
  batch = 10,
): Promise<EmailSenderSummary> {
  const summary: EmailSenderSummary = { sent: 0, retried: 0, failed: 0, reauthorization: 0 };
  const tokens = new Map<string, AccessToken>();
  const revoked = new Set<string>();

  const tokenFor = async (message: ClaimedMessage): Promise<string> => {
    const cached = tokens.get(message.sender_id);
    if (cached && cached.expiresAt.getTime() - EXPIRY_MARGIN_MS > deps.now().getTime()) {
      return cached.token;
    }
    const refresh = await deps.refreshToken(message.store_id, message.sender_address);
    if (refresh === null) throw new AuthorizationError("sender not authorized");
    const fresh = await deps.accessToken(refresh);
    tokens.set(message.sender_id, fresh);
    return fresh.token;
  };

  for (const message of await deps.claim(batch)) {
    const log = deps.logger.child({ message_id: message.id });
    if (revoked.has(message.sender_id)) {
      await deps.complete(message.id, "retry", undefined, "sender reauthorization required");
      summary.retried++;
      continue;
    }
    try {
      const providerId = await deps.send(await tokenFor(message), {
        from: message.sender_address,
        to: message.recipient,
        subject: message.subject,
        body: message.body,
        ...(message.in_reply_to ? { inReplyTo: message.in_reply_to } : {}),
      });
      await deps.complete(message.id, "sent", providerId);
      summary.sent++;
      log.info("email.sent");
    } catch (error) {
      if (error instanceof AuthorizationError) {
        revoked.add(message.sender_id);
        tokens.delete(message.sender_id);
        await deps.markReauthorization(message.sender_id);
        await deps.complete(message.id, "retry", undefined, "sender reauthorization required");
        await deps.alerts.send({
          severity: "critical",
          title: "Gmail precisa de nova autorização",
          detail: "Envios pausados até a conta da loja ser autorizada novamente.",
        });
        summary.reauthorization++;
        summary.retried++;
        log.error("email.reauthorization_required");
      } else if (error instanceof UpstreamError && error.retryable) {
        await deps.complete(message.id, "retry", undefined, error.message);
        summary.retried++;
        log.warn("email.retry", { error });
      } else {
        await deps.complete(message.id, "failed", undefined, (error as Error).message);
        summary.failed++;
        log.error("email.failed", { error });
      }
    }
  }
  return summary;
}
