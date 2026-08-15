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
import type {
  CompletionRequest,
  CompletionResponse,
  LLMClient,
} from "../core/agents/llm/types.ts";
import type {
  SesSender,
  OutlookSender,
} from "../core/channels/email/index.ts";
import {
  createSeriesAColdOpenPlay,
} from "../core/plays/index.ts";
import { seedMayaForDemo } from "./_play_seed.ts";
import {
  registerSignalProjectors,
} from "../core/ingest/projectors.ts";
import { fanoutCandidate } from "../core/ingest/fanout.ts";
import { classifySignal } from "../core/ingest/classify.ts";
import {
  addCompanyExplicit,
  upsertTrackedCompany,
} from "../core/ingest/catalog.ts";
import { ensurePlatformSource } from "../core/ingest/sources.ts";

/**
 * End-to-end integration: drive a catalog candidate through the typed
 * lifecycle (fanout → signal.discovered → projector → signal.ingested →
 * classify → signal.classification.completed → projector → signal.matched)
 * and then kick the series_a_cold_open Play on the matched signal. Proves
 * items 1+2 from the production-readiness goal:
 *
 *   - the projector chain still drives a Play correctly after the
 *     event-owned refactor (no broken seam between ingestion and Plays);
 *   - the Play's signal-status gate (added in this batch) actually fires
 *     when the signal is 'spent' or 'dismissed' before the Play runs.
 */

const SIGNAL_ID_RE = /^[0-9a-f-]{36}$/;

interface SeededWorkspace {
  workspace_id: string;
  icp_id: string;
  source_id: string;
  tracked_company_id: string;
  rep_id: string;
  channel_account_id: string;
  sending_domain_id: string;
}

async function seedWorkspace(pool: Pool): Promise<SeededWorkspace> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `e2e-${workspace_id.slice(0, 8)}`, "projector chain"],
  );
  await pool.query(
    `insert into workspace_ingestion_budgets (workspace_id, daily_candidate_cap, daily_classify_cap)
     values ($1, 100, 100)`,
    [workspace_id],
  );
  // ICP with no hard must-haves so the cheap pre-filter never rejects.
  const icp_id = randomUUID();
  await pool.query(
    `insert into workspace_icps (id, workspace_id, name, description, must_haves, match_threshold)
     values ($1, $2, 'Series-A founders', 'Founders raising Series A', $3::jsonb, 0.6)`,
    [icp_id, workspace_id, JSON.stringify([])],
  );
  const tracked = await upsertTrackedCompany(pool, {
    name: "Acme AI",
    domain: "acme.ai",
    industry: "fintech",
    size_bucket: "10-50",
    greenhouse_id: "acme",
  });
  await addCompanyExplicit(pool, workspace_id, tracked.id);
  const source = await ensurePlatformSource(pool, "greenhouse", "Greenhouse");

  const { rep_id, channel_account_id, sending_domain_id } =
    await seedMayaForDemo(pool, workspace_id);

  return {
    workspace_id,
    icp_id,
    source_id: source.id,
    tracked_company_id: tracked.id,
    rep_id,
    channel_account_id,
    sending_domain_id,
  };
}

async function insertCandidate(
  pool: Pool,
  source_id: string,
  company_id: string,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into signal_candidates (
       id, source_id, external_id, kind, company_id, title, content, url,
       structured, freshness_at
     ) values ($1, $2, $3, 'funding', $4, $5, $6, $7, $8::jsonb, now())`,
    [
      id,
      source_id,
      `ext-${id.slice(0, 8)}`,
      company_id,
      "Acme AI raises $20M Series A",
      "TechCrunch reports Acme AI closed a $20M Series A led by Sequoia.",
      "https://example.com/tc",
      JSON.stringify({}),
    ],
  );
  return id;
}

async function seedPersonAndCompanyGraph(
  pool: Pool,
  workspace_id: string,
  related_company_id: string,
): Promise<{ person_id: string }> {
  // The fanout step upserts the company; we just need a Person at it so the
  // Play has someone to write to.
  const person_id = randomUUID();
  await pool.query(
    `insert into graph_persons (
       id, workspace_id, full_name, title, company_id, emails
     ) values ($1, $2, 'Anne Brown', 'CEO', $3, array['anne@acme.ai']::citext[])`,
    [person_id, workspace_id, related_company_id],
  );
  return { person_id };
}

function mockClassifyLlm(
  icpId: string,
  score = 0.92,
): LLMClient & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(req);
      return {
        content: JSON.stringify({
          kind: "funding",
          per_icp: [{ icp_id: icpId, score, reason: "exact ICP match" }],
        }),
        model: req.model ?? "deepseek-v4-pro",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
}

function mockWriterLlm(subject: string, body: string): LLMClient {
  return {
    async complete() {
      return {
        content: JSON.stringify({ subject, body_text: body }),
        model: "deepseek-v4-pro",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
}

function mockSes(): SesSender & { sent: number } {
  let sent = 0;
  return {
    get sent() {
      return sent;
    },
    async send() {
      sent += 1;
      return { external_id: `ses-${sent}` };
    },
  };
}

const stubOutlook: OutlookSender = {
  async getAccessToken() { return "token"; },
  async confirmSent() { return null; },
  async send() {
    throw new Error("Outlook sender should not be called in this Play");
  },
};

test("projector chain: catalog candidate → fanout → projector → classify → projector → matched → Play sends", async (t) => {
  const fx = await setupPg("play_proj_chain_e2e");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedWorkspace(fx.pool);
    // Wire the signal projectors against this bus. They listen for
    // signal.discovered + signal.classification.completed and materialize
    // signals + emit signal.ingested / matched.
    await registerSignalProjectors({ pool: fx.pool, bus });

    // 1. Stage 1: catalog candidate + fanout. fanout publishes
    //    signal.discovered; projector inserts the workspace signal row.
    const candidate_id = await insertCandidate(
      fx.pool,
      seeded.source_id,
      seeded.tracked_company_id,
    );
    const fanResults = await fanoutCandidate(
      { pool: fx.pool, bus },
      {
        id: candidate_id,
        source_id: seeded.source_id,
        kind: "funding",
        company_id: seeded.tracked_company_id,
        title: "Acme AI raises $20M Series A",
        content: "Series A close",
        url: "https://example.com/tc",
        structured: {},
        novelty_count: 1,
        freshness_at: new Date().toISOString(),
      },
    );
    assert.equal(fanResults.length, 1);
    assert.equal(fanResults[0].outcome, "created");
    const signal_id = fanResults[0].signal_id!;
    assert.match(signal_id, SIGNAL_ID_RE);

    // 2. Wait for the projector to materialize the workspace signal row.
    await until(async () => {
      const r = await fx.pool.query<{ status: string }>(
        `select status::text as status from signals where id = $1`,
        [signal_id],
      );
      return r.rows[0]?.status === "ingested";
    });

    // Seed a Person at the related_company_id the fanout upserted.
    const { rows: relRows } = await fx.pool.query<{
      related_company_id: string;
    }>(
      `select related_company_id from signals where id = $1`,
      [signal_id],
    );
    const related_company_id = relRows[0]?.related_company_id;
    assert.ok(related_company_id, "fanout should have upserted a graph company");
    const { person_id } = await seedPersonAndCompanyGraph(
      fx.pool,
      seeded.workspace_id,
      related_company_id,
    );

    // 3. Stage 2: classify. The classifier emits
    //    signal.classification.completed; the projector materializes
    //    status='matched' + emits signal.matched.
    const classifyLlm = mockClassifyLlm(seeded.icp_id, 0.92);
    const outcome = await classifySignal(
      { pool: fx.pool, bus, llm: classifyLlm },
      { signal_id },
    );
    assert.equal(outcome.status, "matched");

    // 4. Wait for the projector to flip the signal to 'matched' and
    //    emit the public signal.matched event.
    await until(async () => {
      const r = await fx.pool.query<{ status: string }>(
        `select status::text as status from signals where id = $1`,
        [signal_id],
      );
      return r.rows[0]?.status === "matched";
    });
    await until(async () => {
      const r = await fx.pool.query<{ n: string }>(
        `select count(*)::text as n from events
          where workspace_id = $1
            and event_type = 'signal.matched'
            and payload->>'signal_id' = $2`,
        [seeded.workspace_id, signal_id],
      );
      return Number(r.rows[0].n) === 1;
    });

    // 5. Kick the Play with the matched signal. This is the production
    //    integration seam: a future Play-trigger subscriber would do this
    //    automatically off signal.matched.
    const ses = mockSes();
    const judge = createNoopJudge(0.92, 0.6);
    const memory = {
      episodic: createPostgresEpisodicRepository({ pool: fx.pool }),
      semantic: createPostgresSemanticRepository({ pool: fx.pool }),
      procedural: createPostgresProceduralRepository({ pool: fx.pool }),
    };
    const writer = mockWriterLlm(
      "saw your series a",
      "Anne — saw Sequoia led your round. Quick note on infra hires.",
    );
    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });
    runtime.register(
      createSeriesAColdOpenPlay({
        pool: fx.pool,
        bus,
        llm: writer,
        judge,
        memory,
        emailChannelDeps: { ses, outlook: stubOutlook },
      }),
    );

    const run = await runtime.start({
      workspace_id: seeded.workspace_id,
      workflow_name: "series_a_cold_open",
      input: {
        signal_id,
        rep_id: seeded.rep_id,
        person_id,
        channel_account_id: seeded.channel_account_id,
        sending_domain_id: seeded.sending_domain_id,
      },
    });

    await until(
      async () => (await runtime.get(run.id))?.status === "completed",
      { timeout: 8_000 },
    );
    const final = await runtime.get<unknown, {
      status: string;
      message_id?: string;
      external_id?: string;
    }>(run.id);
    assert.equal(final?.status, "completed");
    assert.equal(final?.output?.status, "sent");
    assert.equal(ses.sent, 1);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("signal gate: Play skips immediately when the signal has expired (status='spent')", async (t) => {
  const fx = await setupPg("play_signal_gate_expired");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedWorkspace(fx.pool);
    const company_id = randomUUID();
    await fx.pool.query(
      `insert into graph_companies (id, workspace_id, name, domain)
       values ($1, $2, 'Acme AI', 'acme.ai')`,
      [company_id, seeded.workspace_id],
    );
    const { person_id } = await seedPersonAndCompanyGraph(
      fx.pool,
      seeded.workspace_id,
      company_id,
    );
    // Seed a signal that's already spent — the projector would have flipped
    // it via signal.expiry.requested. We bypass and write directly.
    const signal_id = randomUUID();
    await fx.pool.query(
      `insert into signals (
         id, workspace_id, kind, title, freshness_at,
         related_company_id, related_person_id, status
       ) values (
         $1, $2, 'funding', 'old Series A', now(),
         $3, $4, 'spent'
       )`,
      [signal_id, seeded.workspace_id, company_id, person_id],
    );

    const ses = mockSes();
    const judge = createNoopJudge(0.92, 0.6);
    const memory = {
      episodic: createPostgresEpisodicRepository({ pool: fx.pool }),
      semantic: createPostgresSemanticRepository({ pool: fx.pool }),
      procedural: createPostgresProceduralRepository({ pool: fx.pool }),
    };
    const writer = mockWriterLlm("should not", "be drafted");
    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });
    runtime.register(
      createSeriesAColdOpenPlay({
        pool: fx.pool,
        bus,
        llm: writer,
        judge,
        memory,
        emailChannelDeps: { ses, outlook: stubOutlook },
      }),
    );

    const run = await runtime.start({
      workspace_id: seeded.workspace_id,
      workflow_name: "series_a_cold_open",
      input: {
        signal_id,
        rep_id: seeded.rep_id,
        person_id,
        channel_account_id: seeded.channel_account_id,
        sending_domain_id: seeded.sending_domain_id,
      },
    });

    await until(
      async () => (await runtime.get(run.id))?.status === "completed",
      { timeout: 5_000 },
    );
    const final = await runtime.get<unknown, {
      status: string;
      reason?: string;
      signal_status?: string;
    }>(run.id);
    assert.equal(final?.output?.status, "skipped");
    assert.equal(final?.output?.reason, "signal_expired");
    assert.equal(final?.output?.signal_status, "spent");
    assert.equal(ses.sent, 0);

    // Critical: no message row was inserted because we bailed before step 5.
    const { rows: msgs } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from messages where workspace_id = $1`,
      [seeded.workspace_id],
    );
    assert.equal(Number(msgs[0].n), 0);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("signal gate: Play skips immediately when the signal was dismissed", async (t) => {
  const fx = await setupPg("play_signal_gate_dismissed");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedWorkspace(fx.pool);
    const company_id = randomUUID();
    await fx.pool.query(
      `insert into graph_companies (id, workspace_id, name, domain)
       values ($1, $2, 'Acme AI', 'acme.ai')`,
      [company_id, seeded.workspace_id],
    );
    const { person_id } = await seedPersonAndCompanyGraph(
      fx.pool,
      seeded.workspace_id,
      company_id,
    );
    const signal_id = randomUUID();
    await fx.pool.query(
      `insert into signals (
         id, workspace_id, kind, title, freshness_at,
         related_company_id, related_person_id, status
       ) values (
         $1, $2, 'funding', 'dismissed', now(),
         $3, $4, 'dismissed'
       )`,
      [signal_id, seeded.workspace_id, company_id, person_id],
    );

    const ses = mockSes();
    const judge = createNoopJudge(0.92, 0.6);
    const memory = {
      episodic: createPostgresEpisodicRepository({ pool: fx.pool }),
      semantic: createPostgresSemanticRepository({ pool: fx.pool }),
      procedural: createPostgresProceduralRepository({ pool: fx.pool }),
    };
    const writer = mockWriterLlm("nope", "shouldn't run");
    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });
    runtime.register(
      createSeriesAColdOpenPlay({
        pool: fx.pool,
        bus,
        llm: writer,
        judge,
        memory,
        emailChannelDeps: { ses, outlook: stubOutlook },
      }),
    );

    const run = await runtime.start({
      workspace_id: seeded.workspace_id,
      workflow_name: "series_a_cold_open",
      input: {
        signal_id,
        rep_id: seeded.rep_id,
        person_id,
        channel_account_id: seeded.channel_account_id,
        sending_domain_id: seeded.sending_domain_id,
      },
    });

    await until(
      async () => (await runtime.get(run.id))?.status === "completed",
      { timeout: 5_000 },
    );
    const final = await runtime.get<unknown, {
      status: string;
      reason?: string;
    }>(run.id);
    assert.equal(final?.output?.status, "skipped");
    assert.equal(final?.output?.reason, "signal_dismissed");
    assert.equal(ses.sent, 0);
  } finally {
    await bus.close();
    await fx.close();
  }
});
