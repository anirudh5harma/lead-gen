/**
 * Hot-path evaluation. Sub-threshold generations NEVER reach a channel.
 * See ARCHITECTURE.md "Agent Fabric" #4.
 */

export * from "./types.ts";
export { createNoopJudge, createHeuristicJudge } from "./judge.ts";
export type { HeuristicJudgeOptions } from "./judge.ts";
export { evalGate } from "./gate.ts";
export type { EvalGateOptions } from "./gate.ts";
