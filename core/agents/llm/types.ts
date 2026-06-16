/**
 * LLM client — provider-agnostic surface. Per the pivot-v2 product posture,
 * DeepSeek V4 Flash is the default model; more expensive models require
 * explicit escalation at the call site.
 *
 * The shape is OpenAI-compatible because every serious provider has
 * converged on it (DeepSeek, Anthropic via OpenAI-shim, vLLM, llama.cpp,
 * ...). Anything provider-specific (Anthropic prompt caching, OpenAI
 * structured outputs) goes on a typed extension object, not the base.
 */

import type { LLMModelEscalation } from "./model-policy.ts";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CompletionRequest {
  messages: Message[];
  /** If omitted, the client uses its configured default model. */
  model?: string;
  /** Required when a call asks for an expensive escalation model such as DeepSeek V4 Pro. */
  model_escalation?: LLMModelEscalation;
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  /** Ask for a JSON object response. The judge uses this. */
  response_format?: { type: "text" | "json_object" };
  abort_signal?: AbortSignal;
}

export interface CompletionResponse {
  content: string;
  model: string;
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | string;
  usage: CompletionUsage;
}

export interface LLMClient {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}
