import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AssistantCard,
  AssistantConfirmationRequest,
  AssistantStreamEvent,
} from "../core/product/assistant/types.ts";
import { streamAssistantResponse } from "../core/product/assistant/orchestrator.ts";
import type { LLMClient, StreamCompletionChunk } from "../core/agents/llm/index.ts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

async function collect(
  iterable: AsyncIterable<AssistantStreamEvent>,
): Promise<AssistantStreamEvent[]> {
  const events: AssistantStreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

function streamClient(chunksByCall: StreamCompletionChunk[][]): LLMClient {
  let callIndex = 0;
  return {
    async complete() {
      throw new Error("streamComplete expected");
    },
    async *streamComplete() {
      for (const chunk of chunksByCall[callIndex] ?? []) {
        yield chunk;
      }
      callIndex += 1;
    },
  };
}

test("assistant orchestrator executes read tools and resumes the loop", async () => {
  const llm = streamClient([
    [
      {
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "metrics.get",
              arguments: "{\"metric\":\"reply_rate\",\"window\":\"7d\"}",
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ],
    [
      { delta: "Reply rate is 20% this week." },
      { finish_reason: "stop" },
    ],
  ]);

  let executedToolName: string | null = null;
  const events = await collect(
    streamAssistantResponse({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      message: "How is reply rate this week?",
      llm,
      assertToolAllowed: async () => {},
      publishToolCalled: async () => {},
      dispatchReadTool: async ({ toolCall }) => {
        executedToolName = toolCall.function.name;
        return {
          payload: {
            metric: "reply_rate",
            window: "7d",
            label: "Reply rate",
            value: 0.2,
            unit: "ratio",
            numerator: 2,
            denominator: 10,
          },
          cards: [
            {
              id: "metric-card",
              kind: "summary",
              tone: "default",
              title: "Reply rate",
              body: "Reply rate for 7d.",
            } satisfies AssistantCard,
          ],
        };
      },
    }),
  );

  assert.equal(executedToolName, "metrics.get");
  assert.deepEqual(events, [
    {
      type: "card",
      card: {
        id: "metric-card",
        kind: "summary",
        tone: "default",
        title: "Reply rate",
        body: "Reply rate for 7d.",
      },
    },
    { type: "text-delta", text: "Reply rate is 20% this week." },
    { type: "done", finish_reason: "stop" },
  ]);
});

test("assistant orchestrator emits confirmation for write tools without executing them", async () => {
  const llm = streamClient([
    [
      {
        tool_calls: [
          {
            id: "call_write",
            type: "function",
            function: {
              name: "dispatch_outreach",
              arguments: "{\"limit\":3}",
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ],
  ]);

  let readToolExecuted = false;
  const confirmation: AssistantConfirmationRequest = {
    token: "token_123",
    title: "Dispatch outreach workflows?",
    body: "Needs confirmation.",
    confirm_label: "Dispatch outreach",
    cancel_label: "Cancel",
  };

  const events = await collect(
    streamAssistantResponse({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      message: "Dispatch outreach",
      llm,
      assertToolAllowed: async () => {},
      publishToolCalled: async () => {},
      dispatchReadTool: async () => {
        readToolExecuted = true;
        throw new Error("should not execute");
      },
      prepareConfirmation: async () => ({
        status: "requires_confirmation",
        tool_name: "dispatch_outreach",
        cards: [
          {
            id: "confirm-card",
            kind: "confirmation",
            tone: "warning",
            title: confirmation.title,
            body: confirmation.body,
          },
        ],
        confirmation,
      }),
    }),
  );

  assert.equal(readToolExecuted, false);
  assert.deepEqual(events, [
    {
      type: "confirmation",
      confirmation,
      card: {
        id: "confirm-card",
        kind: "confirmation",
        tone: "warning",
        title: confirmation.title,
        body: confirmation.body,
      },
      call_id: "call_write",
    },
    { type: "done", finish_reason: "stop" },
  ]);
});
