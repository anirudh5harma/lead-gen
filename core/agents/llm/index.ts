/**
 * LLM clients. Per the pivot-v2 cost posture, DeepSeek V4 Flash is the
 * default for drafting, classification, hot-path judges, and optimizer loops.
 * Heavier models require explicit call-site escalation so the rest of the
 * system can stay cheap by default.
 */

export * from "./types.ts";
export {
  createDeepSeekClient,
  createDeepSeekClientFromEnv,
  DeepSeekError,
} from "./deepseek.ts";
export type { DeepSeekOptions } from "./deepseek.ts";
export {
  createBudgetedLLMClient,
  estimateCompletionTokens,
  estimateDeepSeekCostUsd,
  isLLMBudgetExceededError,
  LLMBudgetExceededError,
} from "./budget.ts";
export type { BudgetedLLMClientOptions } from "./budget.ts";
export {
  assertDeepSeekModelAllowed,
  DEEPSEEK_V4_FLASH_MODEL,
  DEEPSEEK_V4_PRO_MODEL,
  LLMModelPolicyError,
  resolveDeepSeekDefaultModel,
} from "./model-policy.ts";
export type {
  LLMModelEscalation,
  LLMModelEscalationReason,
} from "./model-policy.ts";
