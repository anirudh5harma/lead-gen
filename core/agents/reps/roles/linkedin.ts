import type {
  LinkedInChannel,
  LinkedInChannelName,
} from "../../../channels/linkedin/index.ts";
import type {
  ChannelConversation,
  ChannelDraft,
  ChannelSendResult,
} from "../../../channels/types.ts";
import type { GraphCompany, GraphPerson } from "../../../graph/types.ts";
import type { LLMClient } from "../../llm/types.ts";
import type { ProceduralExemplar } from "../../memory/types.ts";
import {
  fallbackSeedPatternKey,
  outreachPatternCandidates,
  outreachSkillPromptBlock,
  type SelectedOutreachSkill,
} from "../../skills/outreach.ts";
import type { ResearchResult } from "./researcher.ts";
import type { RoleAgent, RoleAgentContext } from "../types.ts";
import type { EventBus } from "../../../substrate/events/index.ts";

export interface SignalLinkedInWriterBrief {
  action: LinkedInChannelName;
  pattern_key: string;
  research: Pick<ResearchResult, "signal_summary" | "counterparty_summary">;
  person: Pick<GraphPerson, "full_name" | "given_name">;
  company?: Pick<GraphCompany, "name" | "industry"> | null;
  skill?: SelectedOutreachSkill | null;
}

export interface SignalLinkedInWriterDraft {
  body: string;
  exemplar_ids: string[];
  procedural_exemplars: ProceduralExemplar[];
  pattern_key: string;
  seed_pattern_key: string | null;
  skill: SelectedOutreachSkill | null;
}

export interface LinkedInWriterRoleOptions {
  llm?: LLMClient;
}

export function createLinkedInWriterRole(
  opts: LinkedInWriterRoleOptions = {},
): RoleAgent<SignalLinkedInWriterBrief, SignalLinkedInWriterDraft> {
  return {
    kind: "writer",
    name: opts.llm ? "writer.linkedin.signal.llm" : "writer.linkedin.signal.deterministic",
    async invoke(brief, ctx) {
      const candidates = outreachPatternCandidates(brief.pattern_key, brief.skill);
      const {
        pattern_key,
        seed_pattern_key,
        procedural_exemplars,
      } = await topLinkedInProceduralExemplars(brief, ctx, candidates);
      if (!opts.llm) {
        return deterministicLinkedInDraft(
          brief,
          ctx,
          procedural_exemplars,
          pattern_key,
          seed_pattern_key,
        );
      }

      const response = await opts.llm.complete({
        temperature: 0.6,
        max_tokens: 420,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              `You are writing as ${ctx.rep.name}, a ${ctx.rep.role} Rep.`,
              "Write one concise LinkedIn outreach draft tied to the provided signal.",
              "Return only JSON: { \"body\": \"string\" }.",
            ].join("\n"),
          },
          {
            role: "user",
            content: linkedInWriterPrompt(brief, ctx, procedural_exemplars),
          },
        ],
      });
      const parsed = JSON.parse(response.content) as { body?: string };
      if (!parsed.body?.trim()) {
        throw new Error(`LinkedIn writer returned invalid JSON: ${response.content.slice(0, 200)}`);
      }
      return {
        body: parsed.body.trim(),
        exemplar_ids: procedural_exemplars.map((exemplar) => exemplar.id),
        procedural_exemplars,
        pattern_key,
        seed_pattern_key,
        skill: brief.skill ?? null,
      };
    },
  };
}

async function topLinkedInProceduralExemplars(
  brief: SignalLinkedInWriterBrief,
  ctx: RoleAgentContext,
  candidates: string[],
): Promise<{
  pattern_key: string;
  seed_pattern_key: string | null;
  procedural_exemplars: ProceduralExemplar[];
}> {
  const scope = { workspace_id: ctx.rep.workspace_id, rep_id: ctx.rep.id };
  for (const pattern_key of candidates) {
    const procedural_exemplars = await ctx.memory.procedural.topForPattern(
      scope,
      pattern_key,
      3,
    );
    if (procedural_exemplars.length > 0) {
      return {
        pattern_key,
        seed_pattern_key: fallbackSeedPatternKey(candidates, pattern_key),
        procedural_exemplars,
      };
    }
  }
  const pattern_key = candidates[0] ?? brief.pattern_key;
  return {
    pattern_key,
    seed_pattern_key: fallbackSeedPatternKey(candidates, pattern_key),
    procedural_exemplars: [],
  };
}

function linkedInWriterPrompt(
  brief: SignalLinkedInWriterBrief,
  ctx: RoleAgentContext,
  procedural_exemplars: ProceduralExemplar[],
): string {
  const lines: Array<string | null> = [
    `Channel action: ${brief.action}`,
    `Voice: ${ctx.rep.persona.voice}`,
    ctx.rep.persona.story ? `Story: ${ctx.rep.persona.story}` : null,
    ctx.rep.persona.do_not.length
      ? `Do not: ${ctx.rep.persona.do_not.join("; ")}`
      : null,
    `Recipient: ${brief.person.full_name}`,
    brief.company?.name ? `Company: ${brief.company.name}` : null,
    brief.company?.industry ? `Industry: ${brief.company.industry}` : null,
    `Signal: ${brief.research.signal_summary}`,
    `Counterparty: ${brief.research.counterparty_summary}`,
    outreachSkillPromptBlock(brief.skill),
    ctx.workspace_context_markdown
      ? `Workspace context:\n${ctx.workspace_context_markdown}`
      : null,
  ];

  if (procedural_exemplars.length > 0) {
    lines.push("");
    lines.push("Winning past LinkedIn drafts for this pattern (mirror cadence; do NOT copy):");
    procedural_exemplars.slice(0, 3).forEach((exemplar, index) => {
      lines.push(`Example ${index + 1} (score ${exemplar.score.toFixed(2)}, wins ${exemplar.win_count}):`);
      lines.push(JSON.stringify(exemplar.exemplar));
    });
  }

  lines.push(
    "",
    "Constraints: 35-90 words, no fake familiarity, no unsupported claims, no sign-off.",
  );
  return lines.filter((line): line is string => line !== null).join("\n");
}

function deterministicLinkedInDraft(
  brief: SignalLinkedInWriterBrief,
  ctx: RoleAgentContext,
  procedural_exemplars: ProceduralExemplar[],
  pattern_key: string,
  seed_pattern_key: string | null,
): SignalLinkedInWriterDraft {
  const firstName =
    brief.person.given_name ??
    brief.person.full_name.split(" ")[0] ??
    brief.person.full_name;
  const opener = brief.action === "linkedin_connection"
    ? `Hi ${firstName}, I noticed ${brief.research.signal_summary}.`
    : `Hi ${firstName} - noticed ${brief.research.signal_summary}.`;
  const body = [
    opener,
    `${brief.research.counterparty_summary} feels like relevant context for this timing.`,
    `${ctx.rep.name} can compare notes if this is on your plate.`,
  ].join(" ");
  return {
    body,
    exemplar_ids: procedural_exemplars.map((exemplar) => exemplar.id),
    procedural_exemplars,
    pattern_key,
    seed_pattern_key,
    skill: brief.skill ?? null,
  };
}

export interface LinkedInSenderRequest {
  conversation: ChannelConversation;
  draft: ChannelDraft;
  correlation_id?: string | null;
}

export interface LinkedInSenderRoleOptions {
  linkedin: LinkedInChannel;
  bus: EventBus;
}

export function createLinkedInSenderRole(
  opts: LinkedInSenderRoleOptions,
): RoleAgent<LinkedInSenderRequest, ChannelSendResult> {
  return {
    kind: "sender",
    name: "sender.linkedin.signal",
    async invoke(req, ctx) {
      return opts.linkedin.send(req.conversation, req.draft, {
        workspace_id: ctx.rep.workspace_id,
        bus: opts.bus,
        correlation_id: req.correlation_id ?? null,
      });
    },
  };
}
