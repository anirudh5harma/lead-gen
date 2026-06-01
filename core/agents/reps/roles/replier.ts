import type {
  IntentClassification,
  IntentClassifier,
  ReplyIntent,
} from "../../../channels/email/intent.ts";
import type { LLMClient } from "../../llm/types.ts";
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

export interface ReplyDraftBrief {
  conversation: {
    id: string;
    topic?: string | null;
  };
  inbound: {
    message_id: string;
    subject: string | null;
    body_text: string;
    from_email: string | null;
    intent: ReplyIntent;
    intent_reason?: string | null;
  };
  counterparty: {
    name: string;
    given_name?: string | null;
    company_name?: string | null;
  };
  prior_outbound?: {
    subject?: string | null;
    body_text?: string | null;
  } | null;
}

export interface ReplyDraftResult {
  subject: string;
  body: string;
  body_text: string;
}

export interface ReplyDraftRoleOptions {
  llm?: LLMClient;
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

function replySubject(subject: string | null): string {
  const normalized = subject?.trim() || "Quick follow-up";
  return /^re:/i.test(normalized) ? normalized : `Re: ${normalized}`;
}

function deterministicReplyDraft(brief: ReplyDraftBrief): ReplyDraftResult {
  const firstName = brief.counterparty.given_name ?? brief.counterparty.name.split(" ")[0] ?? "there";
  const positive = brief.inbound.intent === "positive";
  const body = positive
    ? [
        `Hi ${firstName},`,
        "",
        "Thanks for getting back. Glad this is relevant.",
        "",
        "The simplest next step is to compare notes on what changed, what you are trying to avoid, and whether there is a focused path worth exploring.",
        "",
        "Would a short conversation this week make sense?",
        "",
        "-Maya",
      ].join("\n")
    : [
        `Hi ${firstName},`,
        "",
        "Totally fair, and thanks for the context.",
        "",
        "To keep this useful: the reason I reached out was the timing around the work on your side. If it is not a priority now, I can step back. If there is a specific question worth answering, I am happy to keep it tight.",
        "",
        "Worth a quick note either way?",
        "",
        "-Maya",
      ].join("\n");
  return {
    subject: replySubject(brief.inbound.subject),
    body,
    body_text: body,
  };
}

export function createReplyDraftRole(
  opts: ReplyDraftRoleOptions = {},
): RoleAgent<ReplyDraftBrief, ReplyDraftResult> {
  return {
    kind: "replier",
    name: opts.llm ? "replier.email.draft.llm" : "replier.email.draft.deterministic",
    async invoke(brief, ctx) {
      if (!opts.llm) {
        const draft = deterministicReplyDraft(brief);
        return {
          ...draft,
          body: draft.body.replace(/-Maya$/u, `-${ctx.rep.name}`),
          body_text: draft.body_text.replace(/-Maya$/u, `-${ctx.rep.name}`),
        };
      }

      const response = await opts.llm.complete({
        temperature: 0.5,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              `You are replying as ${ctx.rep.name}, a ${ctx.rep.role} Rep.`,
              "Draft one concise email reply in the Rep voice.",
              "Return only JSON: { \"subject\": \"string\", \"body\": \"string\" }.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Voice: ${ctx.rep.persona.voice}`,
              ctx.rep.persona.story ? `Story: ${ctx.rep.persona.story}` : null,
              ctx.rep.persona.do_not.length ? `Do not: ${ctx.rep.persona.do_not.join("; ")}` : null,
              `Counterparty: ${brief.counterparty.name}${brief.counterparty.company_name ? ` at ${brief.counterparty.company_name}` : ""}`,
              `Conversation topic: ${brief.conversation.topic ?? "-"}`,
              `Reply intent: ${brief.inbound.intent}`,
              brief.inbound.intent_reason ? `Intent reason: ${brief.inbound.intent_reason}` : null,
              brief.prior_outbound?.body_text
                ? `Prior outbound:\n${brief.prior_outbound.body_text.slice(0, 1200)}`
                : null,
              `Inbound reply:\n${brief.inbound.body_text.slice(0, 2000)}`,
              ctx.workspace_context_markdown
                ? `Workspace context:\n${ctx.workspace_context_markdown}`
                : null,
              "Constraints: 60-180 words, no overpromising, no fake scheduling claim, ask for one concrete next step.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      });
      const parsed = JSON.parse(response.content) as { subject?: string; body?: string };
      if (!parsed.subject || !parsed.body) {
        throw new Error(`replier draft role returned invalid JSON: ${response.content.slice(0, 200)}`);
      }
      return {
        subject: parsed.subject,
        body: parsed.body,
        body_text: parsed.body,
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
