/**
 * Hot-path eval: every generation that targets a channel passes a judge
 * before reaching `channel.send()`. Sub-threshold drafts never send.
 *
 * See ARCHITECTURE.md "Agent Fabric" — hard rule #4. The judge is intended
 * to be small/fast (Haiku-class). It returns a score, a binary pass/fail
 * against a workspace-tunable threshold, and structured notes that flow
 * into procedural memory.
 */

import type { Rep } from "../../primitives/index.ts";
import type {
  EventPayload,
  PublishedEvent,
} from "../../substrate/events/index.ts";
import type { ProceduralExemplar, SemanticEntry } from "../memory/types.ts";

export interface JudgeInput {
  workspace_id: string;
  rep: Pick<Rep, "id" | "name" | "role" | "persona">;

  /** What is being judged: typically a draft, sometimes a plan. */
  artifact: {
    kind: "draft" | "plan" | "post" | "reply" | "other";
    channel?: string;
    subject?: string | null;
    body: string;
  };

  /** Optional retrieved context the writer used. The judge sees what the writer saw. */
  context?: {
    signal_summary?: string;
    counterparty_summary?: string;
    procedural_exemplars?: ProceduralExemplar[];
    semantic_memory?: SemanticEntry[];
    /** Prompt-ready account/person/timing/evidence context the writer saw. */
    personalization_context_markdown?: string | null;
    /** Prompt-ready workspace context the writer saw. */
    workspace_context_markdown?: string | null;
    /** Selected Play Skill framework the writer/replier used. */
    outreach_skill?: {
      skill_key: string;
      version: string;
      name: string;
      framework: string[];
      judge_focus: string[];
      slot_values?: Record<string, string>;
      pattern_key?: string;
      seed_pattern_key?: string | null;
    } | null;
  };
}

export interface JudgeVerdict {
  /** 0..1. 1 is best. */
  score: number;
  /** Tunable threshold. Workspace-configurable; default 0.6. */
  threshold: number;
  passed: boolean;
  notes: {
    /** Per-axis sub-scores. Useful for procedural memory updates. */
    axes: Record<string, number>;
    /** Free-text critique from the judge. */
    critique: string;
    /** Specific rewrite suggestions, if any. */
    suggestions?: string[];
  };
  /** Latency observed. Useful for the eval dashboard. */
  duration_ms: number;
}

export interface Judge {
  /** Evaluate a draft. Implementations may be LLM-backed or rule-backed. */
  evaluate(input: JudgeInput): Promise<JudgeVerdict>;
}

export interface EvalGateResult {
  verdict: JudgeVerdict;
  decision: "pass" | "reject";
  events: {
    judged: PublishedEvent<EventPayload<"draft.judged">>;
    rejected?: PublishedEvent<EventPayload<"draft.rejected">>;
  };
  /** When decision === 'reject', this is the reason emitted to the bus. */
  rejection_reason?: string;
}
