import { randomUUID } from "node:crypto";
import {
  createDeepSeekClientFromEnv,
  type LLMClient,
  type Message,
  type StreamCompletionChunk,
  type ToolFunctionCall,
} from "../../agents/llm/index.ts";
import type { ToolContext } from "../../agents/tools/types.ts";
import {
  assertAssistantToolAllowed,
  publishAssistantToolCalled,
} from "./telemetry.ts";
import { executeAssistantTool } from "./tool-surface.ts";
import {
  assistantQueryToolSpecs,
  assistantToolRequiresConfirmation,
  dispatchAssistantQueryTool,
} from "./query-surface.ts";
import { buildAssistantInstructions } from "./instructions.ts";
import { presentErrorCard, presentToolResult } from "./presenters.ts";
import type {
  AssistantCard,
  AssistantChatHistoryTurn,
  AssistantStreamEvent,
} from "./types.ts";

const MAX_TOOL_ITERATIONS = 5;
const MAX_SANITIZED_STRING_LENGTH = 4_000;
const MAX_SANITIZED_ARRAY_ITEMS = 50;
const MAX_SANITIZED_OBJECT_KEYS = 50;

function sanitizeString(value: string): string {
  return value
    .replace(/[^\P{Cc}\t\n\r]/gu, " ")
    .slice(0, MAX_SANITIZED_STRING_LENGTH);
}

function sanitizeToolPayload(value: unknown, depth = 0): unknown {
  if (depth >= 6) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_SANITIZED_ARRAY_ITEMS)
      .map((entry) => sanitizeToolPayload(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_SANITIZED_OBJECT_KEYS)
        .map(([key, entry]) => [key, sanitizeToolPayload(entry, depth + 1)]),
    );
  }
  return String(value);
}

function toolMessageContent(toolName: string, payload: unknown): string {
  return JSON.stringify({
    tool_name: toolName,
    payload: sanitizeToolPayload(payload),
    untrusted_data: true,
  });
}

function historyMessages(history: AssistantChatHistoryTurn[]): Message[] {
  return history.map((turn) => ({
    role: turn.role,
    content: turn.text,
  }));
}

async function* fallbackStreamComplete(
  llm: LLMClient,
  messages: Message[],
): AsyncIterable<StreamCompletionChunk> {
  const response = await llm.complete({
    messages,
    tools: assistantQueryToolSpecs(),
    tool_choice: "auto",
  });

  if (response.content) {
    yield { delta: response.content };
  }
  if (response.tool_calls?.length) {
    yield { tool_calls: response.tool_calls };
  }
  yield { finish_reason: response.finish_reason };
}

async function publishToolTelemetry(input: {
  callId: string | null;
  latencyMs: number;
  publishToolCalled?: typeof publishAssistantToolCalled;
  requiresConfirmation: boolean;
  status: "completed" | "confirmation_pending" | "errored";
  toolName: string;
  userId: string;
  workspaceId: string;
}): Promise<void> {
  await (input.publishToolCalled ?? publishAssistantToolCalled)({
    workspaceId: input.workspaceId,
    userId: input.userId,
    toolName: input.toolName,
    callId: input.callId,
    status: input.status,
    requiresConfirmation: input.requiresConfirmation,
    latencyMs: input.latencyMs,
  }).catch((error) => {
    console.error("[assistant/orchestrator] tool telemetry publish failed", error);
  });
}

async function executeReadTool(input: {
  arguments: Record<string, unknown>;
  ctx: ToolContext & { user_id: string };
  toolCall: ToolFunctionCall;
}): Promise<{
  cards: AssistantCard[];
  payload: Record<string, unknown>;
}> {
  const result = await dispatchAssistantQueryTool({
    toolName: input.toolCall.function.name,
    arguments: input.arguments,
    ctx: input.ctx,
  });
  return {
    cards: presentToolResult(input.toolCall.function.name, result),
    payload: result,
  };
}

export async function* streamAssistantResponse(input: {
  history?: AssistantChatHistoryTurn[];
  llm?: LLMClient;
  message: string;
  userId: string;
  workspaceId: string;
  assertToolAllowed?: typeof assertAssistantToolAllowed;
  dispatchReadTool?: typeof executeReadTool;
  prepareConfirmation?: typeof executeAssistantTool;
  publishToolCalled?: typeof publishAssistantToolCalled;
}): AsyncIterable<AssistantStreamEvent> {
  const llm = input.llm ?? createDeepSeekClientFromEnv();
  const ctx: ToolContext & { user_id: string } = {
    workspace_id: input.workspaceId,
    user_id: input.userId,
  };
  const messages: Message[] = [
    {
      role: "system",
      content: buildAssistantInstructions(),
    },
    ...historyMessages(input.history ?? []),
    {
      role: "user",
      content: input.message,
    },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const assistantText: string[] = [];
    let toolCalls: ToolFunctionCall[] = [];
    let finishReason = "stop";
    const stream = llm.streamComplete
      ? llm.streamComplete({
          messages,
          tools: assistantQueryToolSpecs(),
          tool_choice: "auto",
        })
      : fallbackStreamComplete(llm, messages);

    for await (const chunk of stream) {
      if (chunk.delta) {
        assistantText.push(chunk.delta);
        yield { type: "text-delta", text: chunk.delta };
      }
      if (chunk.tool_calls?.length) {
        toolCalls = chunk.tool_calls;
      }
      if (chunk.finish_reason) {
        finishReason = chunk.finish_reason;
      }
    }

    const assistantContent = assistantText.join("");

    if (!toolCalls.length || finishReason !== "tool_calls") {
      messages.push({
        role: "assistant",
        content: assistantContent || null,
      });
      yield { type: "done", finish_reason: "stop" };
      return;
    }

    messages.push({
      role: "assistant",
      content: assistantContent || null,
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolCallId = toolCall.id || randomUUID();
      let parsedArguments: Record<string, unknown>;

      try {
        parsedArguments = JSON.parse(toolCall.function.arguments || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        const message = `Invalid arguments for ${toolName}: expected JSON.`;
        for (const card of presentErrorCard(toolName, message)) {
          yield { type: "card", card };
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: toolMessageContent(toolName, { error: message }),
        });
        await publishToolTelemetry({
          workspaceId: input.workspaceId,
          userId: input.userId,
          toolName,
          callId: toolCallId,
          publishToolCalled: input.publishToolCalled,
          status: "errored",
          requiresConfirmation: false,
          latencyMs: 0,
        });
        continue;
      }

      if (assistantToolRequiresConfirmation(toolName)) {
        const startedAt = Date.now();
        const confirmation = await (input.prepareConfirmation ?? executeAssistantTool)({
          toolName,
          arguments: parsedArguments,
          ctx,
        });

        if (confirmation.status === "requires_confirmation" && confirmation.confirmation) {
          const card = confirmation.cards[0] ?? {
            id: `confirm:${toolName}`,
            kind: "confirmation" as const,
            tone: "warning" as const,
            title: confirmation.confirmation.title,
            body: confirmation.confirmation.body,
            actions: [
              {
                label: confirmation.confirmation.confirm_label,
                variant: "solid" as const,
              },
            ],
          };
          await publishToolTelemetry({
            workspaceId: input.workspaceId,
            userId: input.userId,
            toolName,
            callId: toolCallId,
            publishToolCalled: input.publishToolCalled,
            status: "confirmation_pending",
            requiresConfirmation: true,
            latencyMs: Date.now() - startedAt,
          });
          yield {
            type: "confirmation",
            confirmation: confirmation.confirmation,
            card,
            call_id: toolCallId,
          };
          yield { type: "done", finish_reason: "stop" };
          return;
        }

        const message =
          confirmation.error ??
          "Confirmation request could not be prepared.";
        for (const card of confirmation.cards) {
          yield { type: "card", card };
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: toolMessageContent(toolName, { error: message }),
        });
        await publishToolTelemetry({
          workspaceId: input.workspaceId,
          userId: input.userId,
          toolName,
          callId: toolCallId,
          publishToolCalled: input.publishToolCalled,
          status: "errored",
          requiresConfirmation: true,
          latencyMs: Date.now() - startedAt,
        });
        continue;
      }

      const startedAt = Date.now();
      try {
        await (input.assertToolAllowed ?? assertAssistantToolAllowed)({
          workspaceId: input.workspaceId,
        });
        const { cards, payload } = await (input.dispatchReadTool ?? executeReadTool)({
          toolCall: { ...toolCall, id: toolCallId },
          arguments: parsedArguments,
          ctx,
        });
        for (const card of cards) {
          yield { type: "card", card };
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: toolMessageContent(toolName, payload),
        });
        await publishToolTelemetry({
          workspaceId: input.workspaceId,
          userId: input.userId,
          toolName,
          callId: toolCallId,
          publishToolCalled: input.publishToolCalled,
          status: "completed",
          requiresConfirmation: false,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const card of presentErrorCard(toolName, message)) {
          yield { type: "card", card };
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: toolMessageContent(toolName, { error: message }),
        });
        await publishToolTelemetry({
          workspaceId: input.workspaceId,
          userId: input.userId,
          toolName,
          callId: toolCallId,
          publishToolCalled: input.publishToolCalled,
          status: "errored",
          requiresConfirmation: false,
          latencyMs: Date.now() - startedAt,
        });
      }
    }
  }

  yield {
    type: "error",
    error: "Assistant stopped after too many tool iterations.",
  };
}
