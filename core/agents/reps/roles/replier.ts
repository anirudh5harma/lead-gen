import type {
  IntentClassification,
  IntentClassifier,
  ReplyIntent,
} from "../../../channels/email/intent.ts";
import type { LLMClient } from "../../llm/types.ts";
import type {
  MemoryScope,
  ProceduralExemplar,
  ProceduralRepository,
  SemanticEntry,
  SemanticRepository,
} from "../../memory/types.ts";
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
  counterparty?: {
    person_id?: string | null;
    company_id?: string | null;
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
  semantic_subjects: string[];
  semantic_facts: Record<string, unknown>;
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
    person_id?: string | null;
    given_name?: string | null;
    title?: string | null;
    company_id?: string | null;
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
  pattern_key: string;
  seed_pattern_key: string | null;
  exemplar_ids: string[];
  procedural_exemplars: ProceduralExemplar[];
  semantic_subjects: string[];
  semantic_memory: SemanticEntry[];
}

export interface ReplyDraftRoleOptions {
  llm?: LLMClient;
}

const OUTCOME_BY_INTENT: Partial<Record<ReplyIntent, ReplierOutcomeRecommendation>> = {
  positive: { kind: "positive_reply", score: 1 },
  unsubscribe: { kind: "unsubscribe", score: -1 },
  do_not_contact: { kind: "do_not_contact", score: -1 },
};

const OBJECTION_PATTERNS = [
  /\bnot\s+(?:a\s+)?priority\b/i,
  /\bno\s+(?:budget|time|capacity|bandwidth)\b/i,
  /\btoo\s+(?:expensive|early|busy)\b/i,
  /\balready\s+(?:use|using|have|working)\b/i,
  /\bneed\s+to\s+(?:check|review|discuss|think)\b/i,
  /\bnot\s+interested\b/i,
  /\bconcern(?:ed)?\b/i,
];

const PREFERENCE_PATTERNS = [
  /\bprefer\b/i,
  /\bwould\s+rather\b/i,
  /\bbest\s+way\b/i,
  /\bsend\s+(?:me|over|across)\b/i,
  /\bemail\s+me\b/i,
  /\bkeep\s+it\s+(?:brief|short|tight|focused)\b/i,
];

const NEXT_STEP_PATTERNS = [
  /\bsend\s+(?:me|over|across)\b/i,
  /\bfollow\s+up\b/i,
  /\bloop\s+in\b/i,
  /\bbook\b/i,
  /\bcall\b/i,
  /\bchat\b/i,
  /\bmeet\b/i,
  /\bcalendar\b/i,
];

const TIMING_PATTERNS = [
  /\b(?:next|this)\s+(?:week|month|quarter)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|today|tomorrow)\b/i,
  /\b(?:q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(?:later|soon)\b/i,
];

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
      const scope = { workspace_id: ctx.rep.workspace_id, rep_id: ctx.rep.id };
      const semantic_facts = replySemanticFacts(brief, classification, outcome);
      const semantic_subjects = await writeReplySemanticMemory(
        brief,
        ctx.memory.semantic,
        scope,
        semantic_facts,
      );
      await ctx.memory.episodic.append(
        scope,
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
        semantic_subjects,
        semantic_facts,
      };
    },
  };
}

function replySemanticFacts(
  brief: ReplierBrief,
  classification: IntentClassification,
  outcome: ReplierOutcomeRecommendation | null,
): Record<string, unknown> {
  const body = brief.inbound.body_text;
  const facts: Record<string, unknown> = {
    latest_reply_intent: classification.intent,
    latest_reply_confidence: Number(classification.confidence.toFixed(2)),
    latest_reply_reason: classification.reason,
    latest_reply_at: brief.inbound.received_at,
    latest_reply_excerpt: excerpt(body, 320),
  };

  const objection = sentenceMatching(body, OBJECTION_PATTERNS);
  if (objection) facts.objection = objection;
  const preference = sentenceMatching(body, PREFERENCE_PATTERNS);
  if (preference) facts.preference = preference;
  const requested_next_step = sentenceMatching(body, NEXT_STEP_PATTERNS);
  if (requested_next_step) facts.requested_next_step = requested_next_step;
  const timing = sentenceMatching(body, TIMING_PATTERNS);
  if (timing) facts.timing = timing;

  if (classification.intent === "unsubscribe") {
    facts.unsubscribe_requested = true;
    facts.channel_preference = "do_not_email";
  }
  if (classification.intent === "do_not_contact" || outcome?.kind === "do_not_contact") {
    facts.do_not_contact = true;
    facts.channel_preference = "do_not_contact";
  }

  return facts;
}

async function writeReplySemanticMemory(
  brief: ReplierBrief,
  semantic: SemanticRepository,
  scope: MemoryScope,
  facts: Record<string, unknown>,
): Promise<string[]> {
  const subjects = [
    brief.counterparty?.person_id
      ? { subject_type: "person" as const, subject_id: brief.counterparty.person_id, facts }
      : null,
    brief.counterparty?.company_id
      ? {
          subject_type: "company" as const,
          subject_id: brief.counterparty.company_id,
          facts: companyReplyFacts(facts),
        }
      : null,
  ].filter(
    (subject): subject is {
      subject_type: "person" | "company";
      subject_id: string;
      facts: Record<string, unknown>;
    } => Boolean(subject),
  );

  const written: string[] = [];
  for (const subject of subjects) {
    await semantic.upsert(scope, {
      subject_type: subject.subject_type,
      subject_id: subject.subject_id,
      facts: subject.facts,
      confidence: 0.72,
    });
    written.push(`${subject.subject_type}:${subject.subject_id}`);
  }
  return written;
}

function companyReplyFacts(facts: Record<string, unknown>): Record<string, unknown> {
  const companyFacts: Record<string, unknown> = {
    latest_contact_reply_intent: facts.latest_reply_intent,
    latest_contact_reply_at: facts.latest_reply_at,
  };
  for (const key of ["objection", "preference", "requested_next_step", "timing"] as const) {
    if (facts[key]) companyFacts[`latest_contact_${key}`] = facts[key];
  }
  return companyFacts;
}

function sentenceMatching(body: string, patterns: RegExp[]): string | null {
  return sentences(body).find((sentence) => patterns.some((pattern) => pattern.test(sentence))) ?? null;
}

function sentences(body: string): string[] {
  return body
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => excerpt(sentence, 260));
}

function excerpt(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function replySubject(subject: string | null): string {
  const normalized = subject?.trim() || "Quick follow-up";
  return /^re:/i.test(normalized) ? normalized : `Re: ${normalized}`;
}

export function buildReplyPatternKey(brief: ReplyDraftBrief): string {
  return buildReplyBasePatternKey(brief);
}

function buildReplyBasePatternKey(brief: ReplyDraftBrief): string {
  const company =
    brief.counterparty.company_name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown-company";
  return `conversation:email|intent:${brief.inbound.intent}|company:${company}|stage:reply`;
}

function buildReplyPatternKeys(
  brief: ReplyDraftBrief,
  semantic_memory: SemanticEntry[],
): string[] {
  const base = buildReplyBasePatternKey(brief);
  const tags = replyPatternTags(brief, semantic_memory);
  if (tags.length === 0) return [base];
  return [`${base}|${tags.join("|")}`, base];
}

function replyPatternTags(
  brief: ReplyDraftBrief,
  semantic_memory: SemanticEntry[],
): string[] {
  const tags = [
    objectionTag(memoryFactText(semantic_memory, ["objection", "latest_contact_objection"])),
    nextStepTag(memoryFactText(semantic_memory, [
      "requested_next_step",
      "latest_contact_requested_next_step",
      "preference",
      "latest_contact_preference",
    ])),
    seniorityTag(brief.counterparty.title),
  ].filter((tag): tag is string => Boolean(tag));
  return Array.from(new Set(tags));
}

function memoryFactText(entries: SemanticEntry[], keys: string[]): string | null {
  for (const entry of entries) {
    for (const key of keys) {
      const value = entry.facts[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function objectionTag(value: string | null): string | null {
  if (!value) return null;
  const text = value.toLowerCase();
  if (/\bsecurity|review|legal|compliance|procurement\b/u.test(text)) {
    return "objection:review";
  }
  if (/\bbudget|price|cost|expensive\b/u.test(text)) return "objection:budget";
  if (/\btime|timing|busy|bandwidth|capacity\b/u.test(text)) return "objection:capacity";
  if (/\balready|using|vendor|solution|tool\b/u.test(text)) {
    return "objection:existing-solution";
  }
  if (/\bnot\s+(?:a\s+)?priority|not\s+interested\b/u.test(text)) {
    return "objection:not-priority";
  }
  return "objection:other";
}

function nextStepTag(value: string | null): string | null {
  if (!value) return null;
  const text = value.toLowerCase();
  if (/\bsend|email|details|options|deck|one-pager|pager\b/u.test(text)) {
    return "next:send-details";
  }
  if (/\bbook|call|chat|meet|meeting|calendar\b/u.test(text)) {
    return "next:book-time";
  }
  if (/\bfollow\s+up|circle\s+back|later|next\s+(?:week|month|quarter)\b/u.test(text)) {
    return "next:follow-up";
  }
  if (/\bloop\s+in|cc\b/u.test(text)) return "next:loop-in";
  return null;
}

function seniorityTag(title: string | null | undefined): string | null {
  if (!title) return null;
  const text = title.toLowerCase();
  if (/\bfounder|co-?founder|owner\b/u.test(text)) return "seniority:founder";
  if (/\bceo|cto|cfo|coo|chief|president\b/u.test(text)) return "seniority:exec";
  if (/\bvp|vice president|head\b/u.test(text)) return "seniority:vp";
  if (/\bdirector\b/u.test(text)) return "seniority:director";
  if (/\bmanager|lead\b/u.test(text)) return "seniority:manager";
  return null;
}

function exemplarText(exemplar: ProceduralExemplar): string | null {
  const body = exemplar.exemplar.body ?? exemplar.exemplar.body_text ?? exemplar.exemplar.reply;
  return typeof body === "string" && body.trim() ? body.trim() : null;
}

function semanticSubjects(brief: ReplyDraftBrief): Array<{ type: "person" | "company"; id: string }> {
  return [
    brief.counterparty.person_id
      ? { type: "person" as const, id: brief.counterparty.person_id }
      : null,
    brief.counterparty.company_id
      ? { type: "company" as const, id: brief.counterparty.company_id }
      : null,
  ].filter((subject): subject is { type: "person" | "company"; id: string } => Boolean(subject));
}

function semanticSubjectKey(entry: SemanticEntry): string {
  return `${entry.subject_type}:${entry.subject_id}`;
}

function semanticFactLines(entries: SemanticEntry[]): string[] {
  return entries.flatMap((entry) => {
    const facts = Object.entries(entry.facts)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .slice(0, 8)
      .map(([key, value]) => `${key}=${formatFactValue(value)}`);
    return facts.length ? [`${semanticSubjectKey(entry)} ${facts.join("; ")}`] : [];
  });
}

function formatFactValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(formatFactValue).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function deterministicReplyDraft(
  brief: ReplyDraftBrief,
  procedural_exemplars: ProceduralExemplar[],
): Pick<ReplyDraftResult, "subject" | "body" | "body_text"> {
  const firstName = brief.counterparty.given_name ?? brief.counterparty.name.split(" ")[0] ?? "there";
  const exemplar = procedural_exemplars.map(exemplarText).find(Boolean);
  if (exemplar) {
    const body = [
      `Hi ${firstName},`,
      "",
      exemplar.replace(/^hi\s+[^,\n]+,?\s*/iu, "").trim(),
      "",
      "-Maya",
    ].join("\n");
    return {
      subject: replySubject(brief.inbound.subject),
      body,
      body_text: body,
    };
  }
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
      const scope = { workspace_id: ctx.rep.workspace_id, rep_id: ctx.rep.id };
      const semantic_memory = await ctx.memory.semantic.forSubjects(
        scope,
        semanticSubjects(brief),
      );
      const semantic_subjects = semantic_memory.map(semanticSubjectKey);
      const pattern_keys = buildReplyPatternKeys(brief, semantic_memory);
      const { pattern_key, procedural_exemplars } = await topProceduralForPatternKeys(
        ctx.memory.procedural,
        scope,
        pattern_keys,
        3,
      );
      if (!opts.llm) {
        const draft = deterministicReplyDraft(brief, procedural_exemplars);
        return {
          ...draft,
          body: draft.body.replace(/-Maya$/u, `-${ctx.rep.name}`),
          body_text: draft.body_text.replace(/-Maya$/u, `-${ctx.rep.name}`),
          pattern_key,
          seed_pattern_key: seedPatternKey(pattern_keys, pattern_key),
          exemplar_ids: procedural_exemplars.map((exemplar) => exemplar.id),
          procedural_exemplars,
          semantic_subjects,
          semantic_memory,
        };
      }

      const semanticLines = semanticFactLines(semantic_memory);
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
              `Counterparty: ${brief.counterparty.name}${brief.counterparty.title ? `, ${brief.counterparty.title}` : ""}${brief.counterparty.company_name ? ` at ${brief.counterparty.company_name}` : ""}`,
              `Conversation topic: ${brief.conversation.topic ?? "-"}`,
              `Reply intent: ${brief.inbound.intent}`,
              brief.inbound.intent_reason ? `Intent reason: ${brief.inbound.intent_reason}` : null,
              brief.prior_outbound?.body_text
                ? `Prior outbound:\n${brief.prior_outbound.body_text.slice(0, 1200)}`
                : null,
              `Inbound reply:\n${brief.inbound.body_text.slice(0, 2000)}`,
              procedural_exemplars.length
                ? [
                    "Winning reply examples for this pattern (mirror approach, do NOT copy):",
                    ...procedural_exemplars.map((exemplar, index) => {
                      const body = exemplarText(exemplar) ?? JSON.stringify(exemplar.exemplar);
                      return `${index + 1}. score=${exemplar.score.toFixed(2)} ${body}`;
                    }),
                  ].join("\n")
                : null,
              semanticLines.length
                ? [
                    "Known memory facts about this person/company (use only if relevant):",
                    ...semanticLines,
                  ].join("\n")
                : null,
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
        pattern_key,
        seed_pattern_key: seedPatternKey(pattern_keys, pattern_key),
        exemplar_ids: procedural_exemplars.map((exemplar) => exemplar.id),
        procedural_exemplars,
        semantic_subjects,
        semantic_memory,
      };
    },
  };
}

function seedPatternKey(pattern_keys: string[], selected: string): string | null {
  const preferred = pattern_keys[0];
  return preferred && preferred !== selected ? preferred : null;
}

async function topProceduralForPatternKeys(
  procedural: ProceduralRepository,
  scope: MemoryScope,
  pattern_keys: string[],
  limit: number,
): Promise<{ pattern_key: string; procedural_exemplars: ProceduralExemplar[] }> {
  for (const pattern_key of pattern_keys) {
    const procedural_exemplars = await procedural.topForPattern(scope, pattern_key, limit);
    if (procedural_exemplars.length > 0) return { pattern_key, procedural_exemplars };
  }
  return { pattern_key: pattern_keys[0]!, procedural_exemplars: [] };
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
