import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  createBudgetedLLMClient,
  isLLMBudgetExceededError,
} from "../core/agents/llm/index.ts";
import type { LLMClient } from "../core/agents/llm/types.ts";
import { createFallbackJudge, createHeuristicJudge } from "../core/agents/eval/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";

class FakeUsagePool {
  readonly rows: Array<{ total_tokens: number; purpose: string }> = [];
  readonly cap: number;

  constructor(cap: number, initialUsed = 0) {
    this.cap = cap;
    if (initialUsed > 0) this.rows.push({ total_tokens: initialUsed, purpose: "seed" });
  }

  async query(_sql: string, params?: unknown[]) {
    const sql = _sql.toLowerCase();
    if (sql.includes("from workspaces")) {
      return {
        rows: [
          {
            daily_token_cap: String(this.cap),
            used_tokens: String(this.rows.reduce((sum, row) => sum + row.total_tokens, 0)),
          },
        ],
      };
    }
    if (sql.includes("insert into workspace_llm_usage")) {
      this.rows.push({
        purpose: String(params?.[1]),
        total_tokens: Number(params?.[5]),
      });
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${_sql}`);
  }
}

test("budgeted LLM: records usage and emits typed usage event", async () => {
  const bus = createInMemoryEventBus();
  const pool = new FakeUsagePool(1000);
  const llm: LLMClient = {
    async complete() {
      return {
        content: "{}",
        model: "mock-model",
        finish_reason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };
    },
  };

  const client = createBudgetedLLMClient({
    llm,
    pool: pool as unknown as Pool,
    bus,
    workspace_id: "00000000-0000-4000-8000-000000000001",
    purpose: "writer.email",
    estimateTokens: () => 100,
  });

  await client.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(pool.rows.at(-1)?.total_tokens, 30);
  assert.equal(bus.published.at(-1)?.event_type, "llm.usage.recorded");
  assert.equal(bus.published.at(-1)?.payload.total_tokens, 30);
});

test("budgeted LLM: rejects before spend and emits defer event", async () => {
  const bus = createInMemoryEventBus();
  const pool = new FakeUsagePool(100, 90);
  let called = false;
  const llm: LLMClient = {
    async complete() {
      called = true;
      throw new Error("should not call provider");
    },
  };

  const client = createBudgetedLLMClient({
    llm,
    pool: pool as unknown as Pool,
    bus,
    workspace_id: "00000000-0000-4000-8000-000000000001",
    purpose: "judge.hot_path",
    estimateTokens: () => 20,
  });

  await assert.rejects(
    client.complete({ messages: [{ role: "user", content: "hello" }] }),
    isLLMBudgetExceededError,
  );
  assert.equal(called, false);
  assert.equal(bus.published.at(-1)?.event_type, "llm.call.deferred");
});

test("fallback judge: degrades to heuristic when budget is exhausted", async () => {
  const primary = {
    async evaluate() {
      throw new Error("budget");
    },
  };
  const judge = createFallbackJudge({
    primary,
    fallback: createHeuristicJudge({ threshold: 0.55 }),
  });

  const verdict = await judge.evaluate({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    rep: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Maya",
      role: "sdr",
      persona: { voice: "warm", do_not: [], samples: [] },
    },
    artifact: {
      kind: "draft",
      channel: "email",
      body: "Hi Nisha, saw the launch and thought it was worth comparing notes this week.",
    },
  });

  assert.equal(verdict.passed, true);
  assert.equal(verdict.notes.axes.degraded_mode, 1);
});
