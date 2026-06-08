/**
 * Rep composition. Users see Reps; agents under the hood are an
 * implementation detail.
 */

import type { EventBus } from "../../substrate/events/index.ts";
import type { EmailChannel } from "../../channels/email/index.ts";
import type { LLMClient } from "../llm/types.ts";
import type { ProceduralExemplar } from "../memory/types.ts";
import type { ResearchResult } from "./roles/researcher.ts";
import type { RoleAgent, RoleAgentContext } from "./types.ts";

export * from "./types.ts";
export { composeRep } from "./compose.ts";

// Concrete role agents — the production wirings.
export { createDeepSeekWriter, buildPatternKey, WriterOutputError } from "./roles/writer.ts";
export type {
  WriterBrief,
  WriterDraft,
  DeepSeekWriterOptions,
} from "./roles/writer.ts";

export { createEmailSender } from "./roles/sender.ts";
export type { SenderRequest, SenderResult, EmailSenderOptions } from "./roles/sender.ts";
export { createResearcherRole } from "./roles/researcher.ts";
export {
  createLinkedInSenderRole,
  createLinkedInWriterRole,
} from "./roles/linkedin.ts";
export type {
  LinkedInSenderRequest,
  LinkedInSenderRoleOptions,
  LinkedInWriterRoleOptions,
  SignalLinkedInWriterBrief,
  SignalLinkedInWriterDraft,
} from "./roles/linkedin.ts";
export {
  buildReplyPatternKey,
  createReplyDraftRole,
  createReplierRole,
  replierStub,
} from "./roles/replier.ts";
export type {
  ReplyDraftBrief,
  ReplyDraftResult,
  ReplyDraftRoleOptions,
  ReplierBrief,
  ReplierOutcomeRecommendation,
  ReplierResult,
  ReplierRoleOptions,
} from "./roles/replier.ts";

export interface SignalEmailWriterBrief {
  channel: "email";
  research: ResearchResult;
  recipient_name: string;
  /**
   * Prompt-ready summary of the targeting company, targeted company/person,
   * timing, and evidence the writer must use for personalization.
   */
  personalization_context_markdown?: string | null;
}

export interface SignalEmailWriterDraft {
  subject: string;
  body: string;
  body_text: string;
  exemplar_ids: string[];
  procedural_exemplars: ProceduralExemplar[];
  personalization_context_markdown?: string | null;
}

export interface WriterRoleOptions {
  llm?: LLMClient;
}

function deterministicEmailDraft(
  brief: SignalEmailWriterBrief,
  ctx: RoleAgentContext,
  procedural_exemplars: ProceduralExemplar[],
): SignalEmailWriterDraft {
  const subject = brief.research.signal_summary.slice(0, 48) || "Quick question";
  const body = [
    `Hi ${brief.recipient_name},`,
    "",
    `I noticed ${brief.research.signal_summary}. ${brief.research.counterparty_summary} stood out as a relevant context for this.`,
    "",
    brief.personalization_context_markdown
      ? `The timing looks relevant because ${firstPersonalizationLine(brief.personalization_context_markdown)}.`
      : null,
    brief.personalization_context_markdown ? "" : null,
    `${ctx.rep.name} can help if this is a priority right now. Worth a short conversation?`,
  ].filter((line): line is string => line !== null).join("\n");
  return {
    subject,
    body,
    body_text: body,
    exemplar_ids: procedural_exemplars.map((exemplar) => exemplar.id),
    procedural_exemplars,
    personalization_context_markdown: brief.personalization_context_markdown ?? null,
  };
}

async function topProceduralExemplars(
  brief: SignalEmailWriterBrief,
  ctx: RoleAgentContext,
): Promise<ProceduralExemplar[]> {
  return ctx.memory.procedural.topForPattern(
    { workspace_id: ctx.rep.workspace_id, rep_id: ctx.rep.id },
    brief.research.pattern_key,
    3,
  );
}

export function createWriterRole(
  opts: WriterRoleOptions = {},
): RoleAgent<SignalEmailWriterBrief, SignalEmailWriterDraft> {
  return {
    kind: "writer",
    name: opts.llm ? "writer.email.signal.llm" : "writer.email.signal.deterministic",
    async invoke(brief, ctx) {
      const procedural_exemplars = await topProceduralExemplars(brief, ctx);
      if (!opts.llm) return deterministicEmailDraft(brief, ctx, procedural_exemplars);
      const outcomeExamples = procedural_exemplars.length
        ? [
          "Outcome learnings from prior successful/failed drafts for this pattern:",
          ...procedural_exemplars.slice(0, 3).map((exemplar, index) =>
            [
              `Example ${index + 1}: score=${exemplar.score.toFixed(2)} wins=${exemplar.win_count} losses=${exemplar.loss_count}`,
              JSON.stringify(exemplar.exemplar),
            ].join("\n")
          ),
        ].join("\n")
        : "Outcome learnings from prior successful/failed drafts for this pattern: none yet.";

      const response = await opts.llm.complete({
        temperature: 0.7,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              `You are writing as ${ctx.rep.name}, a ${ctx.rep.role} Rep.`,
              "Write one concise cold outbound email tied to the provided signal.",
              "Return only JSON: { \"subject\": \"string\", \"body\": \"string\" }.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Voice: ${ctx.rep.persona.voice}`,
              ctx.rep.persona.story ? `Story: ${ctx.rep.persona.story}` : null,
              ctx.rep.persona.do_not.length ? `Do not: ${ctx.rep.persona.do_not.join("; ")}` : null,
              `Recipient first name: ${brief.recipient_name}`,
              `Signal: ${brief.research.signal_summary}`,
              `Counterparty: ${brief.research.counterparty_summary}`,
              brief.personalization_context_markdown
                ? `Personalization context:\n${brief.personalization_context_markdown}`
                : null,
              ctx.workspace_context_markdown
                ? `Workspace context:\n${ctx.workspace_context_markdown}`
                : null,
              outcomeExamples,
              "Constraints: 60-180 words, no generic opener, no clickbait subject, no long sign-off.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(response.content) as {
        subject?: string;
        body?: string;
        body_text?: string;
      };
      const body = parsed.body ?? parsed.body_text;
      if (!parsed.subject || !body) {
        throw new Error(`writer role returned invalid JSON: ${response.content.slice(0, 200)}`);
      }

      return {
        subject: parsed.subject,
        body,
        body_text: body,
        exemplar_ids: procedural_exemplars.map((exemplar) => exemplar.id),
        procedural_exemplars,
        personalization_context_markdown: brief.personalization_context_markdown ?? null,
      };
    },
  };
}

function firstPersonalizationLine(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/^[-#\s]+/, "").trim())
    .find(Boolean) ?? "the signal is fresh";
}

export interface SignalEmailSenderRequest {
  conversation: {
    id: string;
    workspace_id: string;
    rep_id: string;
    counterparty_person_id: string;
    counterparty_email?: string | null;
    topic?: string | null;
  };
  draft: {
    message_id: string;
    channel: "email";
    subject: string;
    body: string;
    eval_passed: boolean;
    eval_score?: number | null;
  };
  email: EmailChannel;
  bus: EventBus;
  correlation_id?: string | null;
}

export function createSenderRole(): RoleAgent<SignalEmailSenderRequest, Awaited<ReturnType<EmailChannel["send"]>>> {
  return {
    kind: "sender",
    name: "sender.email.signal",
    async invoke(req, ctx) {
      return req.email.send(req.conversation, req.draft, {
        workspace_id: ctx.rep.workspace_id,
        bus: req.bus,
        correlation_id: req.correlation_id ?? null,
      });
    },
  };
}

export { researcherStub } from "./roles/researcher.ts";
