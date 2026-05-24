/**
 * Hot-path evaluation. Sub-threshold generations NEVER reach a channel.
 * See ARCHITECTURE.md "Agent Fabric" #4.
 *
 * Production judge: `createDeepSeekJudge` — the same DeepSeek V4 Pro
 * client that the writer uses, with a low-temperature JSON-mode prompt.
 * Dev / tests: `createNoopJudge` and `createHeuristicJudge`.
 */

export * from "./types.ts";
export { createNoopJudge, createHeuristicJudge } from "./judge.ts";
export type { HeuristicJudgeOptions } from "./judge.ts";
export { evalGate } from "./gate.ts";
export type { EvalGateOptions } from "./gate.ts";
export { createDeepSeekJudge } from "./adapters/deepseek-judge.ts";
export type { DeepSeekJudgeOptions } from "./adapters/deepseek-judge.ts";
