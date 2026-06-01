import type { LLMClient } from "../../llm/types.ts";
import type { ProceduralExemplar } from "../../memory/types.ts";
import type { Rep } from "../../../primitives/index.ts";
import type { RoleAgent, RoleAgentContext } from "../types.ts";

/**
 * Writer role agent — DeepSeek-backed implementation.
 *
 * Takes a brief (signal + recipient + channel + procedural exemplars) and
 * produces a draft (subject + body) in the Rep's voice. Returns the
 * exemplar ids the writer was shown so the workflow can stash them in the
 * message's provenance — `wireOutcomeFeedback` reads those later to
 * attribute outcomes back to the exemplars that contributed.
 *
 * Hard rules baked into the system prompt:
 *   - Opening line MUST tie back to the signal (no "Hope you are well").
 *   - Mirror the Rep's voice; honour their do-not list.
 *   - Body between 60 and 180 words. No PS lines, no "Best,".
 *   - Subject: 3-7 words, no clickbait.
 *
 * The LLM is told to respond with a strict JSON object: { subject, body_text }.
 * The writer fails loudly if the model strays — the gate upstream will see
 * the failure and not send anything.
 */

export interface WriterBrief {
  signal: {
    kind: string;
    title: string;
    content?: string | null;
    url?: string | null;
  };
  person: { full_name: string; title?: string | null };
  company: { name: string; industry?: string | null };
  channel: "email" | "linkedin_dm" | "linkedin_inmail" | "x_dm";
  /** Stage of the conversation: `cold_open`, `follow_up_1`, `reply_objection`, ... */
  stage: string;
  /** Exemplars are pre-fetched by the workflow (not by the writer). */
  exemplars: ProceduralExemplar[];
}

export interface WriterDraft {
  subject: string;
  body_text: string;
  body_html?: string;
  /** Used to populate message.provenance.exemplar_ids for outcome attribution. */
  exemplar_ids: string[];
  /** Pattern key the writer used; same key the procedural memory is bucketed by. */
  pattern_key: string;
}

export interface DeepSeekWriterOptions {
  llm: LLMClient;
  /** Override the LLM client's default model id. */
  model?: string;
  temperature?: number;
}

const SYSTEM_PROMPT = `You are an outbound writer-agent acting AS a named Rep with a documented voice.

Produce ONE draft per call: a short cold-open in the Rep's voice that meaningfully references the signal and earns a reply.

Hard rules:
- The opening line MUST tie back to the signal — not a generic compliment.
- Use the Rep's voice; if examples are provided, mirror their cadence (do NOT copy).
- Honour the Rep's "do not" list exactly.
- Body between 60 and 180 words. No PS lines. No sign-offs that say "Best,".
- Subject: 3-7 words, no clickbait, no all-caps.

Respond with a single JSON object and nothing else:
{ "subject": "string", "body_text": "string" }`;

export function buildPatternKey(brief: WriterBrief): string {
  const segment = brief.company.industry
    ? `${brief.company.industry.toLowerCase().replace(/\s+/g, "_")}-founder`
    : "unknown";
  return `icp:${segment}|signal:${brief.signal.kind}|channel:${brief.channel}|stage:${brief.stage}`;
}

function buildUserPrompt(
  brief: WriterBrief,
  rep: Rep,
  workspaceContextMarkdown?: string | null,
): string {
  const lines: Array<string | null> = [
    `Rep: ${rep.name} (${rep.role})`,
    `Voice: ${rep.persona.voice}`,
    rep.persona.story ? `Story: ${rep.persona.story}` : null,
    rep.persona.do_not?.length ? `Do NOT: ${rep.persona.do_not.join("; ")}` : null,
    "",
    `Recipient: ${brief.person.full_name}${brief.person.title ? ` (${brief.person.title})` : ""}`,
    `Company: ${brief.company.name}${brief.company.industry ? ` — ${brief.company.industry}` : ""}`,
    "",
    `Signal: ${brief.signal.kind}`,
    `Signal title: ${brief.signal.title}`,
    brief.signal.content ? `Signal content: ${brief.signal.content}` : null,
    brief.signal.url ? `Signal URL: ${brief.signal.url}` : null,
    "",
    `Channel: ${brief.channel}`,
    `Stage: ${brief.stage}`,
  ];

  if (workspaceContextMarkdown) {
    lines.push("");
    lines.push("Workspace context:");
    lines.push(workspaceContextMarkdown);
  }

  if (brief.exemplars.length > 0) {
    lines.push("");
    lines.push("Winning past drafts for this pattern (mirror cadence; do NOT copy):");
    brief.exemplars.slice(0, 3).forEach((e, i) => {
      lines.push(`Example ${i + 1} (score ${e.score.toFixed(2)}, wins ${e.win_count}):`);
      lines.push(JSON.stringify(e.exemplar));
    });
  }

  lines.push("", "Return ONLY the JSON object.");
  return lines.filter((l): l is string => l !== null).join("\n");
}

export class WriterOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriterOutputError";
  }
}

export function createDeepSeekWriter(
  opts: DeepSeekWriterOptions,
): RoleAgent<WriterBrief, WriterDraft> {
  const temperature = opts.temperature ?? 0.7;

  return {
    kind: "writer",
    name: "writer.deepseek",
    async invoke(brief: WriterBrief, ctx: RoleAgentContext): Promise<WriterDraft> {
      const response = await opts.llm.complete({
        model: opts.model,
        temperature,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildUserPrompt(
              brief,
              ctx.rep,
              ctx.workspace_context_markdown,
            ),
          },
        ],
      });

      let parsed: { subject?: string; body_text?: string };
      try {
        parsed = JSON.parse(response.content) as { subject?: string; body_text?: string };
      } catch {
        throw new WriterOutputError(
          `writer LLM returned non-JSON: ${response.content.slice(0, 200)}`,
        );
      }

      if (!parsed.subject || !parsed.body_text) {
        throw new WriterOutputError(
          `writer LLM response missing subject or body_text: ${response.content.slice(0, 200)}`,
        );
      }

      return {
        subject: parsed.subject,
        body_text: parsed.body_text,
        exemplar_ids: brief.exemplars.map((e) => e.id),
        pattern_key: buildPatternKey(brief),
      };
    },
  };
}
