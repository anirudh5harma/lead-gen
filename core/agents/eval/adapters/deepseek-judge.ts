import type { LLMClient } from "../../llm/types.ts";
import type { Judge, JudgeInput, JudgeVerdict } from "../types.ts";

/**
 * LLM-backed judge. Default implementation uses the same DeepSeek V4 Pro
 * client that the writer uses (per ARCHITECTURE.md "Opinionated Tech
 * Stack" — one model everywhere). Workspaces that BYO a different
 * provider construct a different LLMClient and pass it here.
 *
 * The judge is the hot-path gate (`core/agents/eval/gate.ts`). It runs on
 * EVERY draft that targets a channel; sub-threshold drafts never send.
 * Cost asymmetry is intentionally collapsed — we accept paying for an
 * extra eval call per generation in exchange for one vendor + one
 * billing relationship + one set of guardrails.
 */

export interface DeepSeekJudgeOptions {
  llm: LLMClient;
  /** Score threshold for `passed: true`. Defaults to 0.6. */
  threshold?: number;
  /** Override the model id used for judges. Defaults to the LLM client's default. */
  model?: string;
  /** Sampling temperature for the judge. Low by default — graders should be near-deterministic. */
  temperature?: number;
}

interface RawVerdict {
  score?: number;
  axes?: Record<string, number>;
  critique?: string;
  suggestions?: string[];
}

const SYSTEM_PROMPT = `You are an outbound-quality judge. You evaluate drafts that an AI sales/marketing Rep proposes to send, and decide whether they meet the bar to reach a real recipient.

Score each draft from 0 (do not send) to 1 (excellent) on these axes:
  - voice        : matches the Rep's documented voice
  - relevance    : meaningfully acknowledges the signal / context
  - specificity  : avoids generic templated phrasing
  - length       : appropriate for the channel and stage

Also produce an overall score (0..1, not a simple average — weight by what matters most for the channel and stage), a short critique, and zero or more concrete suggestions for revision.

Respond with a single JSON object and nothing else:
{
  "score":      number,
  "axes":       { "voice": number, "relevance": number, "specificity": number, "length": number },
  "critique":   "string",
  "suggestions": ["string", ...]
}`;

function buildUserPrompt(input: JudgeInput): string {
  const exemplars = (input.context?.procedural_exemplars ?? [])
    .map(
      (e, i) =>
        `Example ${i + 1} (winning, score ${e.score.toFixed(2)}): ${JSON.stringify(e.exemplar)}`,
    )
    .join("\n");
  const semanticMemory = (input.context?.semantic_memory ?? [])
    .map(
      (entry) =>
        `${entry.subject_type}:${entry.subject_id} facts=${JSON.stringify(entry.facts)}`,
    )
    .join("\n");

  return [
    `Rep: ${input.rep.name} (${input.rep.role})`,
    `Voice: ${input.rep.persona.voice}`,
    input.rep.persona.do_not?.length
      ? `Do NOT: ${input.rep.persona.do_not.join("; ")}`
      : null,
    "",
    `Channel: ${input.artifact.channel ?? "(unspecified)"}`,
    `Artifact kind: ${input.artifact.kind}`,
    "",
    `Signal context: ${input.context?.signal_summary ?? "(none provided)"}`,
    `Counterparty context: ${input.context?.counterparty_summary ?? "(none provided)"}`,
    input.context?.workspace_context_markdown
      ? `Workspace context the writer saw:\n${input.context.workspace_context_markdown}`
      : null,
    "",
    exemplars
      ? `Winning examples from past outcomes for this pattern:\n${exemplars}`
      : "Winning examples from past outcomes for this pattern: (none yet)",
    semanticMemory
      ? `Known semantic memory for this counterparty:\n${semanticMemory}`
      : "Known semantic memory for this counterparty: (none yet)",
    "",
    "Draft to judge:",
    input.artifact.subject ? `Subject: ${input.artifact.subject}` : null,
    "Body:",
    input.artifact.body,
    "",
    "Return only the JSON object.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function createDeepSeekJudge(opts: DeepSeekJudgeOptions): Judge {
  const threshold = opts.threshold ?? 0.6;
  const temperature = opts.temperature ?? 0.1;

  return {
    async evaluate(input: JudgeInput): Promise<JudgeVerdict> {
      const started = Date.now();

      const response = await opts.llm.complete({
        model: opts.model,
        temperature,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      });

      let parsed: RawVerdict;
      try {
        parsed = JSON.parse(response.content) as RawVerdict;
      } catch {
        // The judge MUST return JSON. If it doesn't, fail closed (sub-threshold).
        return {
          score: 0,
          threshold,
          passed: false,
          notes: {
            axes: {},
            critique: `judge returned non-JSON response: ${response.content.slice(0, 200)}`,
          },
          duration_ms: Date.now() - started,
        };
      }

      const rawScore = typeof parsed.score === "number" ? parsed.score : 0;
      const score = Math.max(0, Math.min(1, rawScore));
      const axes = parsed.axes && typeof parsed.axes === "object" ? parsed.axes : {};

      return {
        score,
        threshold,
        passed: score >= threshold,
        notes: {
          axes,
          critique: parsed.critique ?? "",
          suggestions:
            Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0
              ? parsed.suggestions
              : undefined,
        },
        duration_ms: Date.now() - started,
      };
    },
  };
}
