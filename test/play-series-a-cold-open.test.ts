import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createPostgresEventBus } from "../core/substrate/events/adapters/postgres.ts";
import { createPostgresWorkflowRuntime } from "../core/substrate/workflows/adapters/postgres.ts";
import {
  createPostgresEpisodicRepository,
  createPostgresProceduralRepository,
  createPostgresSemanticRepository,
} from "../core/agents/memory/adapters/index.ts";
import { createNoopJudge } from "../core/agents/eval/judge.ts";
import type { LLMClient } from "../core/agents/llm/types.ts";
import type {
  SesSender,
  OutlookSender,
} from "../core/channels/email/index.ts";
import {
  createSeriesAColdOpenPlay,
} from "../core/plays/index.ts";
import { seedMayaForDemo } from "./_play_seed.ts";

/**
 * End-to-end smoke test for the first Play. Wires the whole spine:
 *
 *   Postgres event bus  ←→  Postgres workflow runtime  ←→  Play workflow
 *                                                          ↓
 *                                  composedRep (Maya: writer + sender)
 *                                                          ↓
 *                                  evalGate (noop judge — passes everything)
 *                                                          ↓
 *                                  email channel  →  mocked SES
 *                                                          ↓
 *                                  messages row: status='sent'
 *
 * Externals are mocked (LLM returns canned JSON, SES returns a fake id).
 * Everything in between is the real code path.
 */

async function seedSignalGraph(
  pool: Pool,
  workspace_id: string,
): Promise<{
  signal_id: string;
  person_id: string;
  company_id: string;
}> {
  const company_id = randomUUID();
  await pool.query(
    `insert into graph_companies (id, workspace_id, name, domain, industry)
     values ($1, $2, 'Acme AI', 'acme.ai', 'fintech')`,
    [company_id, workspace_id],
  );
  const person_id = randomUUID();
  await pool.query(
    `insert into graph_persons (
       id, workspace_id, full_name, title, company_id, emails
     ) values ($1, $2, 'Anne Brown', 'CEO', $3, array['anne@acme.ai']::citext[])`,
    [person_id, workspace_id, company_id],
  );
  const signal_id = randomUUID();
  await pool.query(
    `insert into signals (
       id, workspace_id, kind, title, content, url,
       freshness_at, related_company_id, related_person_id, status
     ) values (
       $1, $2, 'funding', 'Acme AI raises $20M Series A',
       'TechCrunch reports Acme AI closed a $20M Series A led by Sequoia.',
       'https://example.com/tc',
       now(), $3, $4, 'matched'
     )`,
    [signal_id, workspace_id, company_id, person_id],
  );
  return { signal_id, person_id, company_id };
}

function mockLlmReturning(subject: string, body: string): LLMClient & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async complete() {
      calls += 1;
      return {
        content: JSON.stringify({ subject, body_text: body }),
        model: "deepseek-v4-pro",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
}

function mockSes(): SesSender & { sent: number; lastFrom?: string } {
  let sent = 0;
  let lastFrom: string | undefined;
  return {
    get sent() {
      return sent;
    },
    get lastFrom() {
      return lastFrom;
    },
    async send({ from }) {
      sent += 1;
      lastFrom = from;
      return { external_id: `ses-${sent}` };
    },
  };
}

const stubOutlook: OutlookSender = {
  async send() {
    throw new Error("Outlook sender should not be called in this Play");
  },
};

async function seedWorkspace(pool: Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "test ws"],
  );
  return ws;
}

test("series-a cold open: end-to-end happy path sends through the spine", async (t) => {
  const fx = await setupPg("play_e2e");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const workspace_id = await seedWorkspace(fx.pool);
    const { rep_id, channel_account_id, sending_domain_id, sending_domain } =
      await seedMayaForDemo(fx.pool, workspace_id);
    const { signal_id, person_id } = await seedSignalGraph(fx.pool, workspace_id);

    const llm = mockLlmReturning(
      "saw your series a",
      "Anne — saw Sequoia led your round. Curious whether infra is a near-term hire " +
        "for you; the founders we work with at this stage usually punt for a quarter and " +
        "regret it. If useful: 15 min to compare notes?",
    );
    const ses = mockSes();
    const judge = createNoopJudge(0.92, 0.6);

    const memory = {
      episodic: createPostgresEpisodicRepository({ pool: fx.pool }),
      semantic: createPostgresSemanticRepository({ pool: fx.pool }),
      procedural: createPostgresProceduralRepository({ pool: fx.pool }),
    };

    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });
    runtime.register(
      createSeriesAColdOpenPlay({
        pool: fx.pool,
        bus,
        llm,
        judge,
        memory,
        emailChannelDeps: { ses, outlook: stubOutlook },
      }),
    );

    const run = await runtime.start({
      workspace_id,
      workflow_name: "series_a_cold_open",
      input: { signal_id, rep_id, person_id, channel_account_id, sending_domain_id },
    });

    await until(
      async () => {
        const status = (await runtime.get(run.id))?.status;
        return status === "completed" || status === "failed";
      },
      { timeout: 30_000 },
    );
    const final = await runtime.get<unknown, {
      status: string;
      message_id: string;
      conversation_id: string;
      external_id?: string;
      reason?: string;
    }>(run.id);

    assert.equal(final?.status, "completed");
    assert.equal(final?.output?.status, "sent");
    assert.match(String(final?.output?.external_id ?? ""), /^ses-/);

    // The writer was called once; SES was called once with From = maya@<sending_domain>.
    assert.equal(llm.calls, 1);
    assert.equal(ses.sent, 1);
    assert.equal(ses.lastFrom, `maya@${sending_domain}`);

    // The messages row reflects the send.
    const { rows: msgs } = await fx.pool.query<{
      status: string;
      eval_passed: boolean;
      eval_score: string;
      external_id: string | null;
      subject: string;
      provenance: { pattern_key?: string };
    }>(
      `select status, eval_passed, eval_score::text as eval_score,
              external_id, subject, provenance
         from messages where id = $1`,
      [final?.output?.message_id],
    );
    const msg = msgs[0];
    assert.equal(msg.status, "sent");
    assert.equal(msg.eval_passed, true);
    assert.equal(Number(msg.eval_score), 0.92);
    assert.equal(msg.subject, "saw your series a");
    assert.match(
      msg.provenance.pattern_key ?? "",
      /^icp:fintech-founder\|signal:funding\|channel:email\|stage:cold_open$/,
    );

    // A conversation was opened with origin_signal_id pointing back to the signal.
    const { rows: convs } = await fx.pool.query<{
      origin_signal_id: string;
      status: string;
      topic: string;
    }>(
      `select origin_signal_id, status::text as status, topic
         from conversations where id = $1`,
      [final?.output?.conversation_id],
    );
    assert.equal(convs[0].origin_signal_id, signal_id);
    assert.equal(convs[0].topic, "saw your series a");

    // The bus saw the full lifecycle.
    const { rows: events } = await fx.pool.query<{ event_type: string }>(
      `select event_type from events
        where workspace_id = $1
          and event_type in ('draft.judged', 'message.queued', 'message.sent')
        order by occurred_at asc`,
      [workspace_id],
    );
    const types = events.map((e) => e.event_type);
    assert.ok(types.includes("draft.judged"));
    assert.ok(types.includes("message.queued"));
    assert.ok(types.includes("message.sent"));

    // Workflow journaled each step to workflow_steps.
    const { rows: steps } = await fx.pool.query<{ step_name: string; status: string }>(
      `select step_name, status::text as status from workflow_steps
        where run_id = $1 order by step_position asc`,
      [run.id],
    );
    assert.deepEqual(
      steps.map((s) => s.step_name),
      [
        "load_context",
        "retrieve_exemplars",
        "draft",
        "create_conversation_and_message",
        "eval_gate",
        "project_eval",
        "send",
      ],
    );
    assert.ok(steps.every((s) => s.status === "completed"));
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("series-a cold open: sub-threshold draft is rejected and does not send", async (t) => {
  const fx = await setupPg("play_reject");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const workspace_id = await seedWorkspace(fx.pool);
    const { rep_id, channel_account_id, sending_domain_id } =
      await seedMayaForDemo(fx.pool, workspace_id);
    const { signal_id, person_id } = await seedSignalGraph(fx.pool, workspace_id);

    const llm = mockLlmReturning(
      "hello",
      "Hope you're well. Wanted to connect about your recent news!",
    );
    const ses = mockSes();
    // Threshold 0.9, score 0.3 → fail.
    const judge = createNoopJudge(0.3, 0.9);
    const memory = {
      episodic: createPostgresEpisodicRepository({ pool: fx.pool }),
      semantic: createPostgresSemanticRepository({ pool: fx.pool }),
      procedural: createPostgresProceduralRepository({ pool: fx.pool }),
    };

    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });
    runtime.register(
      createSeriesAColdOpenPlay({
        pool: fx.pool,
        bus,
        llm,
        judge,
        memory,
        emailChannelDeps: { ses, outlook: stubOutlook },
      }),
    );

    const run = await runtime.start({
      workspace_id,
      workflow_name: "series_a_cold_open",
      input: { signal_id, rep_id, person_id, channel_account_id, sending_domain_id },
    });

    await until(
      async () => {
        const status = (await runtime.get(run.id))?.status;
        return status === "completed" || status === "failed";
      },
      { timeout: 30_000 },
    );
    const final = await runtime.get<unknown, { status: string; eval_score: number }>(
      run.id,
    );

    assert.equal(final?.output?.status, "rejected");
    assert.equal(final?.output?.eval_score, 0.3);
    // SES was NEVER called.
    assert.equal(ses.sent, 0);

    // The `send` step was not executed (judge failed the gate before it).
    const { rows: steps } = await fx.pool.query<{ step_name: string }>(
      `select step_name from workflow_steps where run_id = $1`,
      [run.id],
    );
    const names = new Set(steps.map((s) => s.step_name));
    assert.ok(!names.has("send"));
    assert.ok(names.has("eval_gate"));
  } finally {
    await bus.close();
    await fx.close();
  }
});
