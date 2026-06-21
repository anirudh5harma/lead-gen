import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMClient,
} from "../core/agents/llm/types.ts";
import { classifySignal } from "../core/ingest/classify.ts";
import { startClassifyWorkflow } from "../core/ingest/classify-workflow.ts";
import { registerSignalProjectors } from "../core/ingest/projectors.ts";

interface SeedResult {
  workspace_id: string;
  icp_funding_id: string;
  icp_hiring_id: string;
}

async function seedWorkspace(pool: Pool): Promise<SeedResult> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  await pool.query(
    `insert into workspace_ingestion_budgets (workspace_id, daily_classify_cap)
     values ($1, 100)`,
    [workspace_id],
  );
  const icp_funding_id = randomUUID();
  await pool.query(
    `insert into workspace_icps (id, workspace_id, name, description, must_haves, match_threshold)
     values ($1, $2, 'Funding watchers', 'Series A–C funding rounds in tech', $3::jsonb, 0.7)`,
    [
      icp_funding_id,
      workspace_id,
      JSON.stringify([{ field: "kind", op: "in", value: ["funding", null] }]),
    ],
  );
  const icp_hiring_id = randomUUID();
  await pool.query(
    `insert into workspace_icps (id, workspace_id, name, description, must_haves, match_threshold)
     values ($1, $2, 'Hiring trends', 'Senior eng hiring at fintechs', $3::jsonb, 0.6)`,
    [
      icp_hiring_id,
      workspace_id,
      JSON.stringify([]),
    ],
  );
  return { workspace_id, icp_funding_id, icp_hiring_id };
}

async function insertSignal(
  pool: Pool,
  workspace_id: string,
  opts: {
    kind?: string | null;
    title?: string;
    content?: string;
    structured?: Record<string, unknown>;
    properties?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into signals (
       id, workspace_id, kind, title, content, freshness_at, status, properties
     ) values ($1, $2, $3, $4, $5, now(), 'ingested', $6::jsonb)`,
    [
      id,
      workspace_id,
      opts.kind ?? null,
      opts.title ?? "Acme raises $20M Series A",
      opts.content ?? "TechCrunch reports Acme AI closed a $20M Series A.",
      JSON.stringify({
        ...(opts.properties ?? {}),
        structured: opts.structured ?? opts.properties?.structured ?? {},
      }),
    ],
  );
  return id;
}

function mockLlm(payload: Record<string, unknown>): LLMClient & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(req);
      return {
        content: JSON.stringify(payload),
        model: req.model ?? "deepseek-v4-pro",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
}

function mockLlmContent(content: string): LLMClient {
  return {
    async complete() {
      return {
        content,
        model: "deepseek-v4-pro",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
}

async function createProjectingBus(pool: Pool) {
  const bus = createInMemoryEventBus();
  await registerSignalProjectors({ pool, bus });
  return bus;
}

// ─── classifySignal: happy paths ──────────────────────────────────────────

test("classify: matched per-ICP — emits one signal.matched per scoring ICP", async (t) => {
  const fx = await setupPg("cls_match");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, icp_funding_id, icp_hiring_id } = await seedWorkspace(fx.pool);
    const signal_id = await insertSignal(fx.pool, workspace_id, {
      kind: null,
      title: "Acme raises $20M Series A",
    });
    const llm = mockLlm({
      kind: "funding",
      per_icp: [
        { icp_id: icp_funding_id, score: 0.92, reason: "Series A in tech." },
        { icp_id: icp_hiring_id, score: 0.4, reason: "Not hiring-specific." },
      ],
    });

    const result = await classifySignal(
      { pool: fx.pool, bus, llm },
      { signal_id },
    );
    assert.equal(result.status, "matched");
    if (result.status === "matched") {
      assert.equal(result.kind, "funding");
      assert.deepEqual(result.matched_icp_ids, [icp_funding_id]);
    }

    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status::text as status from signals where id = $1`,
        [signal_id],
      );
      return rows[0].status === "matched";
    });
    const { rows } = await fx.pool.query<{
      kind: string;
      match_score: string;
      status: string;
      audience_hint: Record<string, unknown>;
    }>(
      `select kind::text as kind, match_score::text as match_score, status::text as status, audience_hint
         from signals where id = $1`,
      [signal_id],
    );
    assert.equal(rows[0].kind, "funding");
    assert.equal(Number(rows[0].match_score), 0.92);
    assert.equal(rows[0].status, "matched");

    await new Promise((r) => setImmediate(r));
    const matched = bus.published.filter((e) => e.event_type === "signal.matched");
    assert.equal(matched.length, 1);
    assert.equal(
      (matched[0].payload as { icp_segment: string }).icp_segment,
      icp_funding_id,
    );
  } finally {
    await fx.close();
  }
});

test("classify: best-score wins for match_score; multiple ICPs above threshold emit multiple events", async (t) => {
  const fx = await setupPg("cls_multi");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, icp_funding_id, icp_hiring_id } = await seedWorkspace(fx.pool);
    const signal_id = await insertSignal(fx.pool, workspace_id, { kind: null });
    const llm = mockLlm({
      kind: "funding",
      per_icp: [
        { icp_id: icp_funding_id, score: 0.95, reason: "Direct match." },
        { icp_id: icp_hiring_id, score: 0.72, reason: "Adjacent hiring signal." },
      ],
    });
    await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });

    await until(() =>
      bus.published.filter((e) => e.event_type === "signal.matched").length === 2,
    );
    const matched = bus.published.filter((e) => e.event_type === "signal.matched");
    assert.equal(matched.length, 2);
    const ids = matched
      .map((e) => (e.payload as { icp_segment: string }).icp_segment)
      .sort();
    assert.deepEqual(ids, [icp_funding_id, icp_hiring_id].sort());

    const { rows } = await fx.pool.query<{ match_score: string }>(
      `select match_score::text as match_score from signals where id = $1`,
      [signal_id],
    );
    assert.equal(Number(rows[0].match_score), 0.95);
  } finally {
    await fx.close();
  }
});

test("classify: source quality metadata feeds ICP filters and the scoring prompt", async (t) => {
  const fx = await setupPg("cls_quality");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
    );
    await fx.pool.query(
      `insert into workspace_ingestion_budgets (workspace_id, daily_classify_cap)
       values ($1, 100)`,
      [workspace_id],
    );
    const icp_id = randomUUID();
    await fx.pool.query(
      `insert into workspace_icps (id, workspace_id, name, description, must_haves, match_threshold)
       values ($1, $2, 'Official high-intent hiring', 'Fresh official hiring signals', $3::jsonb, 0.6)`,
      [
        icp_id,
        workspace_id,
        JSON.stringify([
          { field: "source_tier", op: "eq", value: "official" },
          { field: "buying_intent.level", op: "eq", value: "high" },
          { field: "timing.conversion_window", op: "eq", value: "now" },
        ]),
      ],
    );
    const signal_id = await insertSignal(fx.pool, workspace_id, {
      kind: "hiring",
      title: "Acme hiring a founding AE",
      content: "Acme is hiring a founding Account Executive for GTM expansion.",
      structured: { function: "sales", seniority: "founding" },
      properties: {
        source_tier: "official",
        source_authority: 0.95,
        source_credibility: {
          version: "source_credibility.v1",
          tier: "official",
          score: 0.95,
        },
        buying_intent: {
          version: "buying_intent.v1",
          score: 0.92,
          level: "high",
          reasons: ["go-to-market hiring trigger"],
        },
        timing: {
          score: 0.96,
          conversion_window: "now",
          freshness_hours: 2,
          reason: "fresh event; timing is strong",
        },
        signal_quality: {
          version: "signal_quality.v1",
          score: 0.94,
          level: "high",
        },
      },
    });
    const llm = mockLlm({
      kind: "hiring",
      per_icp: [{ icp_id, score: 0.82, reason: "Official fresh GTM hire." }],
    });

    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(result.status, "matched");
    assert.equal(llm.calls.length, 1);
    const prompt = llm.calls[0].messages.at(-1)?.content ?? "";
    assert.match(prompt, /source_credibility/);
    assert.match(prompt, /buying_intent/);
    assert.match(prompt, /conversion_window/);
  } finally {
    await fx.close();
  }
});

test("classify: ICP failing must_haves cannot match from model output", async (t) => {
  const fx = await setupPg("cls_must_gate");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
    );
    await fx.pool.query(
      `insert into workspace_ingestion_budgets (workspace_id, daily_classify_cap)
       values ($1, 100)`,
      [workspace_id],
    );
    const passing_icp_id = randomUUID();
    const failing_icp_id = randomUUID();
    await fx.pool.query(
      `insert into workspace_icps (id, workspace_id, name, description, must_haves, match_threshold)
       values
         ($1, $2, 'Hiring only', 'Hiring signals only', $3::jsonb, 0.6),
         ($4, $2, 'Funding only', 'Funding signals only', $5::jsonb, 0.6)`,
      [
        passing_icp_id,
        workspace_id,
        JSON.stringify([{ field: "kind", op: "eq", value: "hiring" }]),
        failing_icp_id,
        JSON.stringify([{ field: "kind", op: "eq", value: "funding" }]),
      ],
    );
    const signal_id = await insertSignal(fx.pool, workspace_id, {
      kind: "hiring",
      title: "Acme hiring a founding AE",
    });
    const llm = mockLlm({
      kind: "hiring",
      per_icp: [
        { icp_id: failing_icp_id, score: 0.99, reason: "Model leaked an off-gate ICP." },
        { icp_id: passing_icp_id, score: 0.2, reason: "Below threshold." },
      ],
      dismissal_reason: "below threshold for eligible ICPs",
    });

    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(result.status, "dismissed");
    await until(() =>
      bus.published.some((e) => e.event_type === "signal.dismissed"),
    );
    assert.equal(
      bus.published.some((e) => e.event_type === "signal.matched"),
      false,
    );
  } finally {
    await fx.close();
  }
});

// ─── Dismissal paths ──────────────────────────────────────────────────────

test("classify: every score below threshold → dismissed", async (t) => {
  const fx = await setupPg("cls_dismiss");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, icp_funding_id, icp_hiring_id } = await seedWorkspace(fx.pool);
    const signal_id = await insertSignal(fx.pool, workspace_id, { kind: null });
    const llm = mockLlm({
      kind: "press_mention",
      per_icp: [
        { icp_id: icp_funding_id, score: 0.2, reason: "Marginal." },
        { icp_id: icp_hiring_id, score: 0.1, reason: "Not hiring." },
      ],
      dismissal_reason: "off-icp press mention",
    });

    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(result.status, "dismissed");

    await until(() =>
      bus.published.some((e) => e.event_type === "signal.dismissed"),
    );
    const { rows } = await fx.pool.query<{ status: string }>(
      `select status::text as status from signals where id = $1`,
      [signal_id],
    );
    assert.equal(rows[0].status, "dismissed");
    const dismissed = bus.published.filter((e) => e.event_type === "signal.dismissed");
    assert.equal(dismissed.length, 1);
  } finally {
    await fx.close();
  }
});

test("classify: no ICPs → emits dismissed and skips LLM entirely", async (t) => {
  const fx = await setupPg("cls_no_icp");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
    );
    await fx.pool.query(
      `insert into workspace_ingestion_budgets (workspace_id) values ($1)`,
      [workspace_id],
    );
    const signal_id = await insertSignal(fx.pool, workspace_id);

    const llm = mockLlm({ kind: "other", per_icp: [] });
    const result = await classifySignal(
      { pool: fx.pool, bus, llm },
      { signal_id },
    );
    assert.equal(result.status, "skipped");
    if (result.status === "skipped") assert.equal(result.reason, "no_icps");
    assert.equal((llm as unknown as { calls: unknown[] }).calls.length, 0);

    await until(() =>
      bus.published.some((e) => e.event_type === "signal.dismissed"),
    );
    const { rows } = await fx.pool.query<{ status: string }>(
      `select status::text as status from signals where id = $1`,
      [signal_id],
    );
    assert.equal(rows[0].status, "dismissed");
  } finally {
    await fx.close();
  }
});

test("classify: budget exhausted → no LLM call, status untouched", async (t) => {
  const fx = await setupPg("cls_budget");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id } = await seedWorkspace(fx.pool);
    await fx.pool.query(
      `update workspace_ingestion_budgets set daily_classify_cap = 0 where workspace_id = $1`,
      [workspace_id],
    );
    const signal_id = await insertSignal(fx.pool, workspace_id);
    const llm = mockLlm({ kind: "funding", per_icp: [] });

    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(result.status, "skipped");
    if (result.status === "skipped") assert.equal(result.reason, "budget");
    assert.equal((llm as unknown as { calls: unknown[] }).calls.length, 0);

    const { rows } = await fx.pool.query<{ status: string }>(
      `select status::text as status from signals where id = $1`,
      [signal_id],
    );
    assert.equal(rows[0].status, "ingested");
  } finally {
    await fx.close();
  }
});

test("classify: structured pre-filter (must_haves) blocks LLM when no ICPs match", async (t) => {
  const fx = await setupPg("cls_pre");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
    );
    await fx.pool.query(
      `insert into workspace_ingestion_budgets (workspace_id) values ($1)`,
      [workspace_id],
    );
    // ICP that requires kind=hiring; we'll pass a funding signal.
    await fx.pool.query(
      `insert into workspace_icps (workspace_id, name, description, must_haves)
       values ($1, 'hiring only', 'x', $2::jsonb)`,
      [workspace_id, JSON.stringify([{ field: "kind", op: "eq", value: "hiring" }])],
    );
    const signal_id = await insertSignal(fx.pool, workspace_id, { kind: "funding" });
    const llm = mockLlm({ kind: "funding", per_icp: [] });

    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(result.status, "skipped");
    if (result.status === "skipped") assert.equal(result.reason, "filtered");
    assert.equal((llm as unknown as { calls: unknown[] }).calls.length, 0);
  } finally {
    await fx.close();
  }
});

test("classify: non-JSON model output fails closed (dismissed, not crashed)", async (t) => {
  const fx = await setupPg("cls_garbage");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id } = await seedWorkspace(fx.pool);
    const signal_id = await insertSignal(fx.pool, workspace_id);
    const llm = mockLlmContent("this is not JSON, the model strayed");

    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(result.status, "skipped");
    if (result.status === "skipped") assert.equal(result.reason, "non_json");
    await until(() =>
      bus.published.some((e) => e.event_type === "signal.dismissed"),
    );
    const dismissed = bus.published.filter((e) => e.event_type === "signal.dismissed");
    assert.equal(dismissed.length, 1);
    assert.equal(
      (dismissed[0].payload as { reason: string }).reason,
      "classifier_non_json",
    );
  } finally {
    await fx.close();
  }
});

test("classify: fenced JSON is tolerated on first attempt", async (t) => {
  const fx = await setupPg("cls_fenced");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, icp_funding_id } = await seedWorkspace(fx.pool);
    const signal_id = await insertSignal(fx.pool, workspace_id, { kind: null });
    const llm = mockLlmContent(
      "```json\n" +
        JSON.stringify({
          kind: "funding",
          per_icp: [{ icp_id: icp_funding_id, score: 0.9, reason: "Fenced but valid." }],
        }) +
        "\n```",
    );
    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(result.status, "matched");
    if (result.status === "matched") assert.equal(result.kind, "funding");
  } finally {
    await fx.close();
  }
});

test("classify: prose-prefixed JSON is tolerated on first attempt", async (t) => {
  const fx = await setupPg("cls_prose");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, icp_funding_id } = await seedWorkspace(fx.pool);
    const signal_id = await insertSignal(fx.pool, workspace_id, { kind: null });
    const llm = mockLlmContent(
      "Here is the classification:\n" +
        JSON.stringify({
          kind: "funding",
          per_icp: [{ icp_id: icp_funding_id, score: 0.88, reason: "Prose-prefixed." }],
        }),
    );
    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(result.status, "matched");
  } finally {
    await fx.close();
  }
});

test("classify: retry recovers a signal when first attempt is garbage", async (t) => {
  const fx = await setupPg("cls_retry");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, icp_funding_id } = await seedWorkspace(fx.pool);
    const signal_id = await insertSignal(fx.pool, workspace_id, { kind: null });
    const goodJson = JSON.stringify({
      kind: "funding",
      per_icp: [{ icp_id: icp_funding_id, score: 0.91, reason: "Recovered on retry." }],
    });
    let callCount = 0;
    const llm: LLMClient = {
      async complete() {
        callCount++;
        return {
          content: callCount === 1 ? "Sorry, I strayed into prose." : goodJson,
          model: "deepseek-v4-pro",
          finish_reason: "stop",
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
      },
    };
    const result = await classifySignal({ pool: fx.pool, bus, llm }, { signal_id });
    assert.equal(callCount, 2);
    assert.equal(result.status, "matched");
    if (result.status === "matched") assert.equal(result.kind, "funding");
  } finally {
    await fx.close();
  }
});

// ─── startClassifyWorkflow: subscription wiring ───────────────────────────

test("workflow: subscribes to signal.ingested and processes asynchronously", async (t) => {
  const fx = await setupPg("cls_wf");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, icp_funding_id } = await seedWorkspace(fx.pool);
    const signal_id = await insertSignal(fx.pool, workspace_id, { kind: null });
    const llm = mockLlm({
      kind: "funding",
      per_icp: [{ icp_id: icp_funding_id, score: 0.9, reason: "match" }],
    });
    const wf = await startClassifyWorkflow({ pool: fx.pool, bus, llm });
    try {
      await bus.publish({
        workspace_id,
        event_type: "signal.ingested",
        source: "system",
        payload: {
          signal_id,
          source_id: null,
          kind: null,
          novelty_score: null,
        },
      });
      await until(
        () => bus.published.some((e) => e.event_type === "signal.matched"),
      );
    } finally {
      await wf.subscription.unsubscribe();
    }
  } finally {
    await fx.close();
  }
});

test("workflow: handler errors are caught (subscription survives)", async (t) => {
  const fx = await setupPg("cls_wf_err");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  const errors: unknown[] = [];
  try {
    // LLM client that always throws.
    const llm: LLMClient = {
      async complete() {
        throw new Error("upstream down");
      },
    };
    const wf = await startClassifyWorkflow({
      pool: fx.pool,
      bus,
      llm,
      onError: (err) => errors.push(err),
    });
    try {
      const { workspace_id } = await seedWorkspace(fx.pool);
      const signal_id = await insertSignal(fx.pool, workspace_id, { kind: null });
      await bus.publish({
        workspace_id,
        event_type: "signal.ingested",
        source: "system",
        payload: { signal_id, source_id: null, kind: null, novelty_score: null },
      });
      await until(() => errors.length === 1);
      assert.match(String((errors[0] as Error).message), /upstream down/);
      // Subscription is still alive — emit another event; another error
      // logged but the process didn't crash.
      const signal_id_2 = await insertSignal(fx.pool, workspace_id, { kind: null });
      await bus.publish({
        workspace_id,
        event_type: "signal.ingested",
        source: "system",
        payload: { signal_id: signal_id_2, source_id: null, kind: null, novelty_score: null },
      });
      await until(() => errors.length === 2);
    } finally {
      await wf.subscription.unsubscribe();
    }
  } finally {
    await fx.close();
  }
});
