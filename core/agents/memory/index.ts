/**
 * Rep memory — three explicit tiers. See ./types.ts and ARCHITECTURE.md.
 *
 * Procedural memory is the moat: it grows from positive outcomes, and the
 * hot-path judge (core/agents/eval/) retrieves from it as few-shot examples
 * when grading new drafts. The outcome → procedural loop is the single
 * compounding asset in pivot-v2.
 */

export * from "./types.ts";
export * from "./adapters/index.ts";
export {
  wireOutcomeFeedback,
  DEFAULT_SCORE_DELTAS,
} from "./bridges.ts";
export type {
  OutcomeAttributionFetcher,
  ScoreDeltas,
  WireOutcomeFeedbackOptions,
  WiredOutcomeFeedback,
} from "./bridges.ts";
export { createPostgresOutcomeAttribution } from "./attribution.ts";
export type { PostgresAttributionOptions } from "./attribution.ts";
