import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDeepSeekClient,
  DeepSeekError,
} from "../core/agents/llm/deepseek.ts";
import {
  DEEPSEEK_V4_FLASH_MODEL,
  DEEPSEEK_V4_PRO_MODEL,
  LLMModelPolicyError,
} from "../core/agents/llm/index.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function chatBody(content: string, model = DEEPSEEK_V4_FLASH_MODEL): unknown {
  return {
    model,
    choices: [
      {
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

test("deepseek client: posts to /chat/completions with bearer auth and JSON body", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createDeepSeekClient({
    apiKey: "sk-test",
    defaultModel: DEEPSEEK_V4_FLASH_MODEL,
    fetchImpl: async (input, init) => {
      calls.push({
        url: typeof input === "string" ? input : (input as URL).toString(),
        init: init!,
      });
      return jsonResponse(chatBody("hello"));
    },
  });

  const out = await client.complete({
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "ping" },
    ],
    temperature: 0.2,
    max_tokens: 100,
  });

  assert.equal(out.content, "hello");
  assert.equal(out.model, DEEPSEEK_V4_FLASH_MODEL);
  assert.equal(out.usage.total_tokens, 15);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sk-test");

  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.model, DEEPSEEK_V4_FLASH_MODEL);
  assert.equal(sent.temperature, 0.2);
  assert.equal(sent.max_tokens, 100);
  assert.deepEqual(sent.messages, [
    { role: "system", content: "be brief" },
    { role: "user", content: "ping" },
  ]);
});

test("deepseek client: defaults to V4 Flash", async () => {
  let sent: { model?: string } = {};
  const client = createDeepSeekClient({
    apiKey: "sk",
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init!.body));
      return jsonResponse(chatBody("hello"));
    },
  });

  await client.complete({ messages: [{ role: "user", content: "ping" }] });

  assert.equal(sent.model, DEEPSEEK_V4_FLASH_MODEL);
});

test("deepseek client: blocks V4 Pro without explicit escalation", async () => {
  let called = false;
  const client = createDeepSeekClient({
    apiKey: "sk",
    fetchImpl: async () => {
      called = true;
      return jsonResponse(chatBody("should not happen", DEEPSEEK_V4_PRO_MODEL));
    },
  });

  await assert.rejects(
    client.complete({
      model: DEEPSEEK_V4_PRO_MODEL,
      messages: [{ role: "user", content: "hard synthesis" }],
    }),
    (err) =>
      err instanceof LLMModelPolicyError &&
      err.model === DEEPSEEK_V4_PRO_MODEL,
  );
  assert.equal(called, false);
});

test("deepseek client: allows V4 Pro with explicit escalation", async () => {
  let sent: { model?: string } = {};
  const client = createDeepSeekClient({
    apiKey: "sk",
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init!.body));
      return jsonResponse(chatBody("deep answer", DEEPSEEK_V4_PRO_MODEL));
    },
  });

  const out = await client.complete({
    model: DEEPSEEK_V4_PRO_MODEL,
    model_escalation: {
      reason: "operator_approved_investigation",
      approved_by: "operator",
    },
    messages: [{ role: "user", content: "investigate this failure" }],
  });

  assert.equal(sent.model, DEEPSEEK_V4_PRO_MODEL);
  assert.equal(out.model, DEEPSEEK_V4_PRO_MODEL);
});

test("deepseek client: forwards response_format for json_object mode", async () => {
  let sent: { response_format?: { type: string } } = {};
  const client = createDeepSeekClient({
    apiKey: "sk",
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init!.body));
      return jsonResponse(chatBody('{"ok":true}'));
    },
  });
  await client.complete({
    messages: [{ role: "user", content: "x" }],
    response_format: { type: "json_object" },
  });
  assert.deepEqual(sent.response_format, { type: "json_object" });
});

test("deepseek client: retries on 5xx then succeeds", async () => {
  let attempt = 0;
  const client = createDeepSeekClient({
    apiKey: "sk",
    retries: 2,
    fetchImpl: async () => {
      attempt += 1;
      if (attempt < 2) {
        return new Response("upstream wobble", { status: 503 });
      }
      return jsonResponse(chatBody("recovered"));
    },
  });
  const out = await client.complete({
    messages: [{ role: "user", content: "x" }],
  });
  assert.equal(attempt, 2);
  assert.equal(out.content, "recovered");
});

test("deepseek client: 4xx (non-429) fails fast without retry", async () => {
  let attempt = 0;
  const client = createDeepSeekClient({
    apiKey: "sk",
    retries: 5,
    fetchImpl: async () => {
      attempt += 1;
      return new Response("bad request", { status: 400 });
    },
  });
  await assert.rejects(
    client.complete({ messages: [{ role: "user", content: "x" }] }),
    (err) =>
      err instanceof DeepSeekError &&
      err.status === 400 &&
      /bad request/.test(err.body),
  );
  assert.equal(attempt, 1);
});

test("deepseek client: 429 honours Retry-After then succeeds", async () => {
  let attempt = 0;
  const t0 = Date.now();
  const client = createDeepSeekClient({
    apiKey: "sk",
    retries: 1,
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "1" }, // 1 second
        });
      }
      return jsonResponse(chatBody("ok"));
    },
  });
  const out = await client.complete({ messages: [{ role: "user", content: "x" }] });
  assert.equal(out.content, "ok");
  assert.equal(attempt, 2);
  // Should have waited ~1s for retry-after.
  assert.ok(Date.now() - t0 >= 900, `waited ${Date.now() - t0}ms`);
});

test("deepseek client: caller's abort_signal cancels the request without retry", async () => {
  let attempt = 0;
  const client = createDeepSeekClient({
    apiKey: "sk",
    retries: 3,
    fetchImpl: async (_url, init) => {
      attempt += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted") as Error & { name: string };
          err.name = "AbortError";
          reject(err);
        });
      });
    },
  });

  const controller = new AbortController();
  const p = client.complete({
    messages: [{ role: "user", content: "x" }],
    abort_signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(p, (err) => err instanceof Error && err.name === "AbortError");
  assert.equal(attempt, 1);
});
