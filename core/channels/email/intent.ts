import type { LLMClient } from "../../agents/llm/types.ts";

/**
 * Intent classifier for inbound email replies. The replier role agent
 * uses this; the inbound pipeline calls it directly so a reply lands a
 * `reply.classified` event even without a Rep being composed.
 *
 * Output classes (deliberately narrow):
 *
 *   meeting_intent    — explicitly asks to book, schedule, or receive times
 *   positive          — wants to engage or asks a substantive question
 *   negative          — says no clearly
 *   neutral           — acknowledges, defers, asks for less context
 *   ooo               — auto-reply: out of office / on leave
 *   unsubscribe       — asks to be removed
 *   do_not_contact    — stronger than unsubscribe (legal/angry)
 *   spam              — looks like an autoresponder / bounce body
 *
 * Mapping to outcomes (applied by handleInboundEmail):
 *   meeting_intent    → outcome.kind = positive_reply
 *   positive          → outcome.kind = positive_reply
 *   unsubscribe       → outcome.kind = unsubscribe
 *   do_not_contact    → outcome.kind = do_not_contact
 *   * (others)        → no outcome recorded; status only
 *
 * The classifier MUST return JSON. Fails closed (intent='neutral',
 * confidence=0) when the model strays — neutral is the safest non-action.
 */

export type ReplyIntent =
  | "positive"
  | "meeting_intent"
  | "negative"
  | "neutral"
  | "ooo"
  | "unsubscribe"
  | "do_not_contact"
  | "spam";

export interface IntentClassification {
  intent: ReplyIntent;
  /** 0..1. Clamped at the boundary. */
  confidence: number;
  /** One-sentence rationale. Stored on the message for debugging. */
  reason: string;
}

export interface IntentClassifierInput {
  subject: string;
  body_text: string;
  /** Optional context about the conversation so far. Cheap signal for the LLM. */
  context?: {
    rep_name: string;
    prior_outbound_subject?: string;
    prior_outbound_excerpt?: string;
  };
}

export interface IntentClassifier {
  classify(input: IntentClassifierInput): Promise<IntentClassification>;
}

export interface DeepSeekIntentClassifierOptions {
  llm: LLMClient;
  /** Override the LLM client's default model. */
  model?: string;
  temperature?: number;
}

const SYSTEM_PROMPT = `You classify the intent of an inbound email reply.

Choose ONE class from this fixed set:
  meeting_intent    — explicitly asks to book, schedule, jump on a call, or receive meeting times
  positive          — wants to engage or asks a substantive question, but does not ask to schedule
  negative          — clearly says no, not now, or not interested
  neutral           — acknowledges, defers vaguely, asks for less context
  ooo               — auto-reply: out of office, on leave, parental leave
  unsubscribe       — asks to be removed from outreach
  do_not_contact    — stronger refusal: legal threat, angry, mark-as-spam intent
  spam              — looks like an autoresponder, bounce-in-body, or unrelated

Respond with a single JSON object and nothing else:
{ "intent": "<class>", "confidence": 0..1, "reason": "string (one sentence)" }`;

function buildUserPrompt(input: IntentClassifierInput): string {
  const lines: Array<string | null> = [
    input.context?.rep_name ? `Rep that sent the original: ${input.context.rep_name}` : null,
    input.context?.prior_outbound_subject
      ? `Original subject: ${input.context.prior_outbound_subject}`
      : null,
    input.context?.prior_outbound_excerpt
      ? `Original excerpt:\n${input.context.prior_outbound_excerpt}`
      : null,
    "",
    "Inbound reply:",
    `Subject: ${input.subject}`,
    "Body:",
    input.body_text,
    "",
    "Return ONLY the JSON object.",
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

function isReplyIntent(s: unknown): s is ReplyIntent {
  return (
    s === "positive" ||
    s === "meeting_intent" ||
    s === "negative" ||
    s === "neutral" ||
    s === "ooo" ||
    s === "unsubscribe" ||
    s === "do_not_contact" ||
    s === "spam"
  );
}

export function createDeepSeekIntentClassifier(
  opts: DeepSeekIntentClassifierOptions,
): IntentClassifier {
  const temperature = opts.temperature ?? 0;

  return {
    async classify(input: IntentClassifierInput): Promise<IntentClassification> {
      const response = await opts.llm.complete({
        model: opts.model,
        temperature,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      });

      let parsed: { intent?: unknown; confidence?: unknown; reason?: unknown };
      try {
        parsed = JSON.parse(response.content);
      } catch {
        return {
          intent: "neutral",
          confidence: 0,
          reason: `non-JSON classifier output: ${response.content.slice(0, 120)}`,
        };
      }
      if (!isReplyIntent(parsed.intent)) {
        return {
          intent: "neutral",
          confidence: 0,
          reason: `classifier returned unknown intent ${String(parsed.intent)}`,
        };
      }
      const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0;
      return {
        intent: parsed.intent,
        confidence: Math.max(0, Math.min(1, conf)),
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      };
    },
  };
}

/**
 * Fixed-output classifier for tests. Returns the same intent for every input.
 */
export function createFixedIntentClassifier(
  intent: ReplyIntent,
  confidence = 1,
  reason = "test stub",
): IntentClassifier {
  return {
    async classify(): Promise<IntentClassification> {
      return { intent, confidence, reason };
    },
  };
}
