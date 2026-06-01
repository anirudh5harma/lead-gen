import type {
  IntentClassification,
  IntentClassifier,
  ReplyIntent,
} from "../../../channels/email/intent.ts";
import type { RoleAgent } from "../types.ts";

/**
 * Replier role agent.
 *
 * Responsibility: classify inbound messages on a Conversation (positive /
 * negative / neutral / OOO / unsubscribe), append to the Rep's episodic
 * memory, and recommend any Outcome that should be recorded. Response
 * drafting/approval remains a later Play, so this role is deliberately
 * limited to durable triage + learning signals.
 *
 * Triggers an `outcome.recorded` for positive intents that booking
 * agents can use to attribute meetings.
 */

export interface ReplierBrief {
  conversation: {
    id: string;
    channel: string;
    prior_outbound_subject?: string | null;
    prior_outbound_excerpt?: string | null;
  };
  inbound: {
    message_id: string;
    subject: string;
    body_text: string;
    from_email: string;
    received_at: string;
  };
}

export interface ReplierOutcomeRecommendation {
  kind: "positive_reply" | "unsubscribe" | "do_not_contact";
  score: number;
}

export interface ReplierResult {
  classification: IntentClassification;
  outcome: ReplierOutcomeRecommendation | null;
  handoff_required: boolean;
}

export interface ReplierRoleOptions {
  classifier: IntentClassifier;
}

const OUTCOME_BY_INTENT: Partial<Record<ReplyIntent, ReplierOutcomeRecommendation>> = {
  positive: { kind: "positive_reply", score: 1 },
  unsubscribe: { kind: "unsubscribe", score: -1 },
  do_not_contact: { kind: "do_not_contact", score: -1 },
};

export function createReplierRole(
  opts: ReplierRoleOptions,
): RoleAgent<ReplierBrief, ReplierResult> {
  return {
    kind: "replier",
    name: "replier.email.intent.v1",
    async invoke(brief, ctx) {
      const classification = await opts.classifier.classify({
        subject: brief.inbound.subject,
        body_text: brief.inbound.body_text,
        context: {
          rep_name: ctx.rep.name,
          prior_outbound_subject: brief.conversation.prior_outbound_subject ?? undefined,
          prior_outbound_excerpt: brief.conversation.prior_outbound_excerpt ?? undefined,
        },
      });
      const outcome = OUTCOME_BY_INTENT[classification.intent] ?? null;
      await ctx.memory.episodic.append(
        { workspace_id: ctx.rep.workspace_id, rep_id: ctx.rep.id },
        {
          kind: "reply.classified",
          content: [
            `${brief.inbound.from_email} replied on ${brief.conversation.channel}.`,
            `Intent: ${classification.intent} (${classification.confidence.toFixed(2)}).`,
            classification.reason,
          ]
            .filter(Boolean)
            .join(" "),
          refs: {
            conversation_id: brief.conversation.id,
            message_id: brief.inbound.message_id,
            intent: classification.intent,
            outcome_kind: outcome?.kind ?? null,
          },
          occurred_at: brief.inbound.received_at,
        },
      );
      return {
        classification,
        outcome,
        handoff_required: classification.intent === "positive" || classification.intent === "neutral",
      };
    },
  };
}

export const replierStub: RoleAgent<unknown, unknown> = {
  kind: "replier",
  name: "replier.stub",
  async invoke() {
    throw new Error(
      "replier role agent is not yet implemented; see core/agents/reps/roles/replier.ts",
    );
  },
};
