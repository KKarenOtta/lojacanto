export type MessageKind = "supplier_prospecting" | "supplier_follow_up" | "purchase_order";
export type AutonomyLevel = "L1" | "L2";

export interface SendContext {
  kind: MessageKind;
  level: AutonomyLevel;
  approved: boolean;
  killSwitch: boolean;
  suppressed: boolean;
  replied: boolean;
  sentToday: number;
  previousContacts: number;
  lastContactAt: string | null;
  now: Date;
}

export interface SendLimits {
  dailyProspecting: number;
  followUpAfterDays: number;
  maxContactsPerRecipient: number;
}

export type SendDecision =
  | { send: true }
  | { send: false; reason: string; retryable: boolean };

const DAY_MS = 86_400_000;

export const DEFAULT_LIMITS: SendLimits = {
  dailyProspecting: 10,
  followUpAfterDays: 5,
  maxContactsPerRecipient: 2,
};

function deny(reason: string, retryable: boolean): SendDecision {
  return { send: false, reason, retryable };
}

export function decideSend(
  context: SendContext,
  limits: SendLimits = DEFAULT_LIMITS,
): SendDecision {
  if (context.killSwitch) return deny("kill_switch", true);
  if (context.suppressed) return deny("suppressed", false);

  if (context.kind === "purchase_order") {
    if (context.level === "L1" && !context.approved) return deny("approval_required", true);
    return { send: true };
  }

  if (!context.approved) return deny("template_not_approved", true);
  if (context.replied) return deny("already_replied", false);
  if (context.previousContacts >= limits.maxContactsPerRecipient) {
    return deny("contact_limit", false);
  }
  if (context.sentToday >= limits.dailyProspecting) return deny("daily_limit", true);

  if (context.kind === "supplier_prospecting" && context.previousContacts > 0) {
    return deny("already_contacted", false);
  }
  if (context.kind === "supplier_follow_up") {
    if (context.previousContacts === 0 || context.lastContactAt === null) {
      return deny("no_previous_contact", false);
    }
    const elapsed = context.now.getTime() - Date.parse(context.lastContactAt);
    if (Number.isNaN(elapsed)) throw new RangeError("invalid lastContactAt");
    if (elapsed < limits.followUpAfterDays * DAY_MS) return deny("too_soon", true);
  }
  return { send: true };
}
