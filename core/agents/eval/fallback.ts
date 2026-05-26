import type { Judge, JudgeInput, JudgeVerdict } from "./types.ts";

export interface FallbackJudgeOptions {
  primary: Judge;
  fallback: Judge;
  shouldFallback?: (err: unknown) => boolean;
}

export function createFallbackJudge(opts: FallbackJudgeOptions): Judge {
  return {
    async evaluate(input: JudgeInput): Promise<JudgeVerdict> {
      try {
        return await opts.primary.evaluate(input);
      } catch (err) {
        if (opts.shouldFallback && !opts.shouldFallback(err)) throw err;
        const fallback = await opts.fallback.evaluate(input);
        return {
          ...fallback,
          notes: {
            ...fallback.notes,
            critique: `fallback judge used: ${fallback.notes.critique}`,
            axes: {
              ...fallback.notes.axes,
              degraded_mode: 1,
            },
          },
        };
      }
    },
  };
}
