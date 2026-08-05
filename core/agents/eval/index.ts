/**
 * Hot-path evaluation. Sub-threshold generations NEVER reach a channel.
 * See ARCHITECTURE.md "Agent Fabric" #4.
 *
 * Production judge: `createDeepSeekJudge` — the governed DeepSeek client
 * defaults to V4 Flash, with a low-temperature JSON-mode prompt.
 * Dev / tests: `createNoopJudge` and `createHeuristicJudge`.
 */

export * from "./types.ts";
export { createNoopJudge, createHeuristicJudge } from "./judge.ts";
export type { HeuristicJudgeOptions } from "./judge.ts";
export { evalGate } from "./gate.ts";
export type { EvalGateOptions } from "./gate.ts";
export { createFallbackJudge } from "./fallback.ts";
export type { FallbackJudgeOptions } from "./fallback.ts";
export { applyBrandVoiceGuardrail, evaluateBrandVoice } from "./voice.ts";
export type { BrandVoiceGuardrailOptions } from "./voice.ts";
export {
  createDeepSeekJudge,
  isMalformedJudgeResponseError,
} from "./adapters/deepseek-judge.ts";
export type { DeepSeekJudgeOptions } from "./adapters/deepseek-judge.ts";
