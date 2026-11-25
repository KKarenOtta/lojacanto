import {
  type AutonomyLevel,
  decideSend,
  DEFAULT_LIMITS,
  type MessageKind,
  type SendLimits,
} from "../services/communication/policy.ts";
import {
  type EmailContent,
  followUpEmail,
  prospectingEmail,
} from "../services/communication/templates.ts";
import type { Logger } from "../shared/log.ts";

export const TEMPLATES = {
  supplier_prospecting: "supplier_prospecting@1",
  supplier_follow_up: "supplier_follow_up@1",
} as const;

export interface ProspectingContext {
  sender_id: string;
  sender_address: string;
  approved_templates: string[];
  prospecting_today: number;
}

export interface ProspectCandidate {
  supplier_id: string;
  name: string;
  contact_email: string;
  categories: string[];
  prospect_stage: "candidate" | "contacted";
  suppressed: boolean;
  previous_contacts: number;
  last_contact_at: string | null;
  pending: boolean;
}

export interface PlannedMessage {
  supplierId: string;
  senderId: string;
  kind: Exclude<MessageKind, "purchase_order">;
  recipient: string;
  template: string;
  content: EmailContent;
}

export interface ProspectingDeps {
  storeId: string;
  storeName: string;
  senderName: string;
  level: AutonomyLevel;
  killSwitchActive: () => Promise<boolean>;
  context: (storeId: string) => Promise<ProspectingContext | null>;
  candidates: (storeId: string, limit: number) => Promise<ProspectCandidate[]>;
  enqueue: (storeId: string, message: PlannedMessage) => Promise<string>;
  setStage: (supplierId: string, stage: "contacted") => Promise<void>;
  logger: Logger;
  now: () => Date;
  limits?: SendLimits;
}

export interface ProspectingSummary {
  halted: "kill_switch" | "no_sender" | null;
  planned: number;
  skipped: Record<string, number>;
}

export async function planProspecting(deps: ProspectingDeps): Promise<ProspectingSummary> {
  const summary: ProspectingSummary = { halted: null, planned: 0, skipped: {} };
  const skip = (reason: string) => {
    summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
  };
  if (await deps.killSwitchActive()) return { ...summary, halted: "kill_switch" };
  const context = await deps.context(deps.storeId);
  if (context === null) return { ...summary, halted: "no_sender" };

  const limits = deps.limits ?? DEFAULT_LIMITS;
  let sentToday = context.prospecting_today;
  const now = deps.now();

  for (const candidate of await deps.candidates(deps.storeId, limits.dailyProspecting * 5)) {
    if (sentToday >= limits.dailyProspecting) {
      skip("daily_limit");
      continue;
    }
    if (candidate.pending) {
      skip("pending");
      continue;
    }
    const kind = candidate.previous_contacts === 0 ? "supplier_prospecting" : "supplier_follow_up";
    const template = TEMPLATES[kind];
    const decision = decideSend({
      kind,
      level: deps.level,
      approved: context.approved_templates.includes(template),
      killSwitch: false,
      suppressed: candidate.suppressed,
      replied: false,
      sentToday,
      previousContacts: candidate.previous_contacts,
      lastContactAt: candidate.last_contact_at,
      now,
    }, limits);
    if (!decision.send) {
      skip(decision.reason);
      continue;
    }

    const input = {
      supplierName: candidate.name,
      categories: candidate.categories,
      senderName: deps.senderName,
      storeName: deps.storeName,
      replyTo: context.sender_address,
    };
    try {
      await deps.enqueue(deps.storeId, {
        supplierId: candidate.supplier_id,
        senderId: context.sender_id,
        kind,
        recipient: candidate.contact_email,
        template,
        content: kind === "supplier_prospecting" ? prospectingEmail(input) : followUpEmail(input),
      });
    } catch (error) {
      deps.logger.error("prospecting.enqueue_failed", {
        supplier_id: candidate.supplier_id,
        error,
      });
      skip("enqueue_failed");
      continue;
    }
    if (candidate.prospect_stage === "candidate") {
      await deps.setStage(candidate.supplier_id, "contacted");
    }
    sentToday++;
    summary.planned++;
  }
  deps.logger.info("prospecting.planned", { planned: summary.planned, skipped: summary.skipped });
  return summary;
}
