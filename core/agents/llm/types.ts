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

export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  [key: string]: unknown;
}

export interface ToolFunctionCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolFunctionCall[];
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
  tools?: ToolSpec[];
  tool_choice?:
    | "auto"
    | "none"
    | {
        type: "function";
        function: { name: string };
      };
  stream?: boolean;
  abort_signal?: AbortSignal;
}

export interface CompletionResponse {
  content: string;
  model: string;
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | string;
  usage: CompletionUsage;
  tool_calls?: ToolFunctionCall[];
}

export interface StreamCompletionChunk {
  delta?: string;
  tool_calls?: ToolFunctionCall[];
  finish_reason?: string;
}

export interface LLMClient {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  streamComplete?(req: CompletionRequest): AsyncIterable<StreamCompletionChunk>;
}
