import type { Judge, JudgeInput, JudgeVerdict } from "./types.ts";

/**
 * No-op judge for unit tests and offline dev. Always passes with a fixed
 * score. Production swaps in an LLM-backed judge (Haiku-class) — see
 * `./adapters/anthropic-judge.ts` when it lands.
 */
export function createNoopJudge(score = 0.9, threshold = 0.6): Judge {
  return {
    async evaluate(_input: JudgeInput): Promise<JudgeVerdict> {
      const started = Date.now();
      return {
        score,
        threshold,
        passed: score >= threshold,
        notes: {
          axes: { overall: score },
          critique: "noop judge",
        },
        duration_ms: Date.now() - started,
      };
    },
  };
}

/**
 * Heuristic judge for development before the LLM judge lands. Looks at
 * obvious failure modes (empty body, banned phrases, runaway length). NOT
 * a substitute for the real judge — does not assess voice, relevance, or
 * personalisation.
 */
export interface HeuristicJudgeOptions {
  threshold?: number;
  banned_phrases?: string[];
  max_body_chars?: number;
  min_body_chars?: number;
}

export function createHeuristicJudge(opts: HeuristicJudgeOptions = {}): Judge {
  const threshold = opts.threshold ?? 0.6;
  const banned = (opts.banned_phrases ?? [
    "as an ai language model",
    "i'm sorry, but as an ai",
    "lorem ipsum",
  ]).map((s) => s.toLowerCase());
  const maxLen = opts.max_body_chars ?? 1800;
  const minLen = opts.min_body_chars ?? 40;

  return {
    async evaluate(input: JudgeInput): Promise<JudgeVerdict> {
      const started = Date.now();
      const body = input.artifact.body ?? "";
      const lower = body.toLowerCase();
      const axes: Record<string, number> = {};
      const issues: string[] = [];

      axes.length =
        body.length >= minLen && body.length <= maxLen
          ? 1
          : body.length < minLen
            ? body.length / Math.max(1, minLen)
            : Math.max(0, 1 - (body.length - maxLen) / maxLen);
      if (axes.length < 1) {
        issues.push(
          body.length < minLen ? "body too short" : "body too long",
        );
      }

      const hasBanned = banned.some((b) => lower.includes(b));
      axes.banned = hasBanned ? 0 : 1;
      if (hasBanned) issues.push("contains banned phrase");

      const greetCheck = /^(hi|hey|hello|dear)\b/i.test(body.trim());
      axes.greeting = greetCheck ? 1 : 0.7;

      const score =
        Object.values(axes).reduce((s, v) => s + v, 0) /
        Object.values(axes).length;

      return {
        score,
        threshold,
        passed: score >= threshold,
        notes: {
          axes,
          critique: issues.length === 0 ? "no heuristic issues" : issues.join("; "),
          suggestions:
            issues.length === 0
              ? undefined
              : ["address heuristic issues before re-judging"],
        },
        duration_ms: Date.now() - started,
      };
    },
  };
}
