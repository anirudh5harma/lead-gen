import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeepSeekClient,
  DEEPSEEK_V4_FLASH_MODEL,
} from "../core/agents/llm/index.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function sseResponse(events: string[]): Response {
  return new Response(events.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("deepseek client: complete returns tool calls and forwards tool specs", async () => {
  let sentBody: Record<string, unknown> | null = null;
  const client = createDeepSeekClient({
    apiKey: "sk-test",
    defaultModel: DEEPSEEK_V4_FLASH_MODEL,
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(String(init?.body));
      return jsonResponse({
        model: DEEPSEEK_V4_FLASH_MODEL,
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "metrics_get",
                    arguments: "{\"metric\":\"reply_rate\",\"window\":\"7d\"}",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      });
    },
  });

  const response = await client.complete({
    messages: [{ role: "user", content: "How are we doing?" }],
    tools: [
      {
        type: "function",
        function: {
          name: "metrics_get",
          description: "Read metrics",
          parameters: {
            type: "object",
            properties: {
              metric: { type: "string" },
              window: { type: "string" },
            },
            required: ["metric", "window"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: "auto",
  });

  assert.equal(sentBody?.tools instanceof Array, true);
  assert.equal(sentBody?.tool_choice, "auto");
  assert.equal(response.finish_reason, "tool_calls");
  assert.equal(response.tool_calls?.[0]?.id, "call_123");
  assert.equal(response.tool_calls?.[0]?.function.name, "metrics_get");
});

test("deepseek client: streamComplete reassembles content and fragmented tool calls", async () => {
  const client = createDeepSeekClient({
    apiKey: "sk-test",
    defaultModel: DEEPSEEK_V4_FLASH_MODEL,
    fetchImpl: async () =>
      sseResponse([
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"lo \"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_\",\"type\":\"function\",\"function\":{\"name\":\"metrics_\",\"arguments\":\"{\\\"met\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"123\",\"function\":{\"name\":\"get\",\"arguments\":\"ric\\\":\\\"reply_rate\\\",\\\"window\\\":\\\"7d\\\"}\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: [DONE]\n\n",
      ]),
  });

  const chunks = [];
  for await (const chunk of client.streamComplete!({
    messages: [{ role: "user", content: "status" }],
    tools: [
      {
        type: "function",
        function: {
          name: "metrics_get",
          description: "Read metrics",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      },
    ],
  })) {
    chunks.push(chunk);
  }

  assert.deepEqual(
    chunks.filter((chunk) => typeof chunk.delta === "string").map((chunk) => chunk.delta),
    ["Hel", "lo "],
  );
  const finalToolCalls = chunks
    .filter((chunk) => Array.isArray(chunk.tool_calls))
    .at(-1)?.tool_calls;
  assert.deepEqual(finalToolCalls, [
    {
        id: "call_123",
        type: "function",
        function: {
          name: "metrics_get",
          arguments: "{\"metric\":\"reply_rate\",\"window\":\"7d\"}",
        },
      },
  ]);
  assert.equal(chunks.at(-1)?.finish_reason, "tool_calls");
});
