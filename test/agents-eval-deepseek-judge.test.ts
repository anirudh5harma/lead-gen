import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMClient,
} from "../core/agents/llm/types.ts";
import { createDeepSeekJudge } from "../core/agents/eval/adapters/deepseek-judge.ts";
import type { JudgeInput } from "../core/agents/eval/types.ts";

function mockLLM(
  respond: (req: CompletionRequest) => string,
): LLMClient & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(req);
      return {
        content: respond(req),
        model: req.model ?? "deepseek-v4-pro",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
}

function inputFor(body: string, subject = "Saw your funding"): JudgeInput {
  return {
    workspace_id: randomUUID(),
    rep: {
      id: randomUUID(),
      name: "Maya",
      role: "sdr",
      persona: {
        voice: "warm, direct, founder-to-founder",
        kpis: ["positive replies"],
        do_not: ["use the word synergy"],
        samples: [],
      },
    },
    artifact: { kind: "draft", channel: "email", subject, body },
  };
}

test("deepseek judge: parses a passing JSON verdict end-to-end", async () => {
  const llm = mockLLM(() =>
    JSON.stringify({
      score: 0.82,
      axes: { voice: 0.9, relevance: 0.85, specificity: 0.7, length: 0.85 },
      critique: "Strong opener; could be a touch shorter.",
      suggestions: ["Trim the closing paragraph."],
    }),
  );
  const judge = createDeepSeekJudge({ llm });
  const verdict = await judge.evaluate(inputFor("Hi Anne, ..."));
  assert.equal(verdict.passed, true);
  assert.equal(verdict.score, 0.82);
  assert.equal(verdict.notes.axes.voice, 0.9);
  assert.deepEqual(verdict.notes.suggestions, ["Trim the closing paragraph."]);

  // Verify we ask for JSON mode and use low temperature.
  assert.deepEqual(llm.calls[0].response_format, { type: "json_object" });
  assert.equal(llm.calls[0].temperature, 0.1);
});

test("deepseek judge: clamps score to [0,1] and respects threshold", async () => {
  const llm = mockLLM(() =>
    JSON.stringify({
      score: 1.5,
      axes: { voice: 1 },
      critique: "ok",
    }),
  );
  const judge = createDeepSeekJudge({ llm, threshold: 0.95 });
  const verdict = await judge.evaluate(inputFor("body"));
  assert.equal(verdict.score, 1);
  assert.equal(verdict.passed, true);

  const llmLow = mockLLM(() =>
    JSON.stringify({ score: -0.4, critique: "bad" }),
  );
  const judgeLow = createDeepSeekJudge({ llm: llmLow });
  const low = await judgeLow.evaluate(inputFor("body"));
  assert.equal(low.score, 0);
  assert.equal(low.passed, false);
});

test("deepseek judge: fails closed on non-JSON output", async () => {
  const llm = mockLLM(() => "this is not JSON, the model strayed");
  const judge = createDeepSeekJudge({ llm });
  const verdict = await judge.evaluate(inputFor("body"));
  assert.equal(verdict.passed, false);
  assert.equal(verdict.score, 0);
  assert.match(verdict.notes.critique, /non-JSON/);
});

test("deepseek judge: includes Rep persona + procedural exemplars in the prompt", async () => {
  const llm = mockLLM(() =>
    JSON.stringify({ score: 0.7, axes: {}, critique: "ok" }),
  );
  const judge = createDeepSeekJudge({ llm });
  await judge.evaluate({
    ...inputFor("body"),
    context: {
      signal_summary: "Series A close at $20M",
      counterparty_summary: "CTO, scaling infra",
      procedural_exemplars: [
        {
          id: randomUUID(),
          rep_id: randomUUID(),
          workspace_id: randomUUID(),
          pattern_key: "icp:fintech-founder|signal:series_a|stage:cold_open",
          exemplar: { subject: "saw your TC piece", body: "..." },
          score: 0.91,
          win_count: 3,
          loss_count: 0,
          last_used_at: null,
        },
      ],
      semantic_memory: [
        {
          id: randomUUID(),
          rep_id: randomUUID(),
          workspace_id: randomUUID(),
          subject_type: "company",
          subject_id: randomUUID(),
          facts: { objection: "needs security review before booking" },
          confidence: 0.8,
          last_observed_at: new Date().toISOString(),
        },
      ],
    },
  });
  const userPrompt = llm.calls[0].messages.find((m) => m.role === "user")!.content;
  assert.match(userPrompt, /Voice: warm, direct/);
  assert.match(userPrompt, /Do NOT: use the word synergy/);
  assert.match(userPrompt, /Series A close at \$20M/);
  assert.match(userPrompt, /Winning examples/);
  assert.match(userPrompt, /score 0\.91/);
  assert.match(userPrompt, /Known semantic memory/);
  assert.match(userPrompt, /security review/);
});
