/**
 * LLM clients. Per ARCHITECTURE.md, DeepSeek V4 Pro is the single default
 * for every LLM call — drafting, reasoning, hot-path judges, classification,
 * dedup. Workspaces can BYO Anthropic / OpenAI keys; the LLMClient surface
 * is provider-agnostic so the rest of the system never cares which model
 * is on the other side of a `complete()` call.
 */

export * from "./types.ts";
export {
  createDeepSeekClient,
  createDeepSeekClientFromEnv,
  DeepSeekError,
} from "./deepseek.ts";
export type { DeepSeekOptions } from "./deepseek.ts";
