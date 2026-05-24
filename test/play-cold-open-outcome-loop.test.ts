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
  createPostgresOutcomeAttribution,
  wireOutcomeFeedback,
} from "../core/agents/memory/index.ts";
import { createNoopJudge } from "../core/agents/eval/judge.ts";
import type { LLMClient } from "../core/agents/llm/types.ts";
import {
  createFixedIntentClassifier,
  handleInboundEmail,
  type SesSender,
  type OutlookSender,
  type InboundEmail,
} from "../core/channels/email/index.ts";
import {
  createSeriesAColdOpenPlay,
  seedMayaForDemo,
} from "../core/plays/index.ts";

/**
 * The full outcome loop. Proves that:
 *
 *   1. A Play runs end-to-end and sends an email (the smoke test we already
 *      have proves this).
 *   2. An inbound reply is matched to the outbound, classified, and
 *      converted into an outcome.recorded event.
 *   3. The procedural-memory bridge consumes that event and bumps the
 *      contributing exemplar's score using the provenance.exemplar_ids
 *      that the writer stashed at draft time.
 *   4. After all that, the same exemplar's score is higher than where it
 *      started — the system has *learned* from a real (mocked) outcome.
 */

function mockLlmReturning(subject: string, body: string): LLMClient {
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

function mockSes(): SesSender & { lastExternalId: string | null } {
  let lastExternalId: string | null = null;
  return {
    get lastExternalId() {
      return lastExternalId;
    },
    async send() {
      lastExternalId = `ses-${randomUUID()}`;
      return { external_id: lastExternalId };
    },
  };
}

const stubOutlook: OutlookSender = {
  async send() {
    throw new Error("Outlook should not be called in this Play");
  },
};

async function seedSignalGraph(
  pool: Pool,
  workspace_id: string,
): Promise<{ signal_id: string; person_id: string }> {
  const company_id = randomUUID();
  await pool.query(
    `insert into graph_companies (id, workspace_id, name, domain, industry)
     values ($1, $2, 'Acme AI', 'acme.ai', 'fintech')`,
    [company_id, workspace_id],
  );
  const person_id = randomUUID();
  await pool.query(
    `insert into graph_persons (id, workspace_id, full_name, title, company_id, emails)
     values ($1, $2, 'Anne Brown', 'CEO', $3, array['anne@acme.ai']::citext[])`,
    [person_id, workspace_id, company_id],
  );
  const signal_id = randomUUID();
  await pool.query(
    `insert into signals (
       id, workspace_id, kind, title, content, url,
       freshness_at, related_company_id, related_person_id, status
     ) values ($1, $2, 'funding', 'Acme AI raises $20M Series A',
               'Sequoia led the round.', null,
               now(), $3, $4, 'matched')`,
    [signal_id, workspace_id, company_id, person_id],
  );
  return { signal_id, person_id };
}

test("outcome loop: cold open → positive reply → procedural exemplar score bumps", async (t) => {
  const fx = await setupPg("loop_full");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    // 1. Seed workspace, Maya, and a signal/person/company.
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
    );
    const { rep_id, channel_account_id, sending_domain_id } =
      await seedMayaForDemo(fx.pool, workspace_id);
    const { signal_id, person_id } = await seedSignalGraph(fx.pool, workspace_id);

    // 2. Seed a procedural exemplar matching the pattern Maya will use,
    //    starting at score 0.5.
    const memory = {
      episodic: createPostgresEpisodicRepository({ pool: fx.pool }),
      semantic: createPostgresSemanticRepository({ pool: fx.pool }),
      procedural: createPostgresProceduralRepository({ pool: fx.pool }),
    };
    const pattern_key =
      "icp:fintech-founder|signal:funding|channel:email|stage:cold_open";
    const seededExemplar = await memory.procedural.add(
      { workspace_id, rep_id },
      {
        pattern_key,
        exemplar: { subject: "saw your series a", body: "..." },
        initial_score: 0.5,
      },
    );

    // 3. Wire the outcome → procedural bridge with the real Postgres
    //    attribution. The bridge reads provenance.exemplar_ids from the
    //    outbound message and bumps the exemplars on outcome.recorded.
    const wired = await wireOutcomeFeedback({
      bus,
      procedural: memory.procedural,
      attribution: createPostgresOutcomeAttribution({ pool: fx.pool }),
    });

    // 4. Set up the runtime + register the Play.
    const llm = mockLlmReturning(
      "saw your series a",
      "Anne — saw Sequoia led the round. Most founders at this stage punt on infra hires for a quarter. Open to comparing notes?",
    );
    const ses = mockSes();
    const judge = createNoopJudge(0.9, 0.6);
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

    // 5. Run the Play.
    const run = await runtime.start({
      workspace_id,
      workflow_name: "series_a_cold_open",
      input: {
        signal_id,
        rep_id,
        person_id,
        channel_account_id,
        sending_domain_id,
      },
    });
    await until(
      async () => (await runtime.get(run.id))?.status === "completed",
      { timeout: 5_000 },
    );
    const final = await runtime.get<unknown, {
      status: string;
      message_id: string;
      conversation_id: string;
      external_id?: string;
    }>(run.id);
    assert.equal(final?.output?.status, "sent");
    const outbound_message_id = final!.output!.message_id;

    // Sanity: the outbound row carries the exemplar id in provenance.
    const { rows: provRows } = await fx.pool.query<{
      provenance: { exemplar_ids?: string[]; pattern_key?: string };
    }>(`select provenance from messages where id = $1`, [outbound_message_id]);
    assert.deepEqual(provRows[0].provenance.exemplar_ids, [seededExemplar.id]);
    assert.equal(provRows[0].provenance.pattern_key, pattern_key);

    // 6. Simulate the inbound reply (positive intent).
    await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("positive", 0.95),
      },
      {
        workspace_id,
        external_id: `in-${randomUUID()}`,
        in_reply_to: ses.lastExternalId ?? "",
        from: { email: "anne@acme.ai", name: "Anne" },
        subject: "Re: saw your series a",
        body_text: "Yes — Tuesday 3pm works.",
        received_at: new Date().toISOString(),
      } satisfies InboundEmail,
    );

    // 7. The bridge fires asynchronously off outcome.recorded. Wait for
    //    the exemplar's win_count to bump.
    await until(async () => {
      const top = await memory.procedural.topForPattern(
        { workspace_id, rep_id },
        pattern_key,
        3,
      );
      return top[0]?.win_count === 1;
    }, { timeout: 5_000 });

    const top = await memory.procedural.topForPattern(
      { workspace_id, rep_id },
      pattern_key,
      3,
    );
    // positive_reply delta = +0.10 → 0.5 + 0.10 = 0.6
    assert.equal(top[0].id, seededExemplar.id);
    assert.equal(top[0].score, 0.6);
    assert.equal(top[0].win_count, 1);
    assert.equal(top[0].loss_count, 0);

    // The full event chain shows up in the events table.
    const { rows: events } = await fx.pool.query<{ event_type: string }>(
      `select event_type from events
        where workspace_id = $1
          and event_type in (
            'draft.judged','message.queued','message.sent',
            'reply.received','reply.classified',
            'outcome.recorded','rep.memory.procedural.updated'
          )
        order by occurred_at asc`,
      [workspace_id],
    );
    const types = events.map((e) => e.event_type);
    for (const expected of [
      "draft.judged",
      "message.queued",
      "message.sent",
      "reply.received",
      "reply.classified",
      "outcome.recorded",
      "rep.memory.procedural.updated",
    ]) {
      assert.ok(types.includes(expected), `expected event ${expected}`);
    }

    await wired.unsubscribe();
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("outcome loop: unsubscribe reply punishes the exemplar (loss_count up, score down)", async (t) => {
  const fx = await setupPg("loop_loss");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, "ws", "ws"],
    );
    const { rep_id, channel_account_id, sending_domain_id } =
      await seedMayaForDemo(fx.pool, workspace_id);
    const { signal_id, person_id } = await seedSignalGraph(fx.pool, workspace_id);

    const memory = {
      episodic: createPostgresEpisodicRepository({ pool: fx.pool }),
      semantic: createPostgresSemanticRepository({ pool: fx.pool }),
      procedural: createPostgresProceduralRepository({ pool: fx.pool }),
    };
    const pattern_key =
      "icp:fintech-founder|signal:funding|channel:email|stage:cold_open";
    const seededExemplar = await memory.procedural.add(
      { workspace_id, rep_id },
      {
        pattern_key,
        exemplar: { subject: "saw your series a", body: "..." },
        initial_score: 0.5,
      },
    );

    const wired = await wireOutcomeFeedback({
      bus,
      procedural: memory.procedural,
      attribution: createPostgresOutcomeAttribution({ pool: fx.pool }),
    });

    const llm = mockLlmReturning(
      "saw your series a",
      "Anne — saw Sequoia led. Worth a 15-minute call to compare notes?",
    );
    const ses = mockSes();
    const judge = createNoopJudge(0.9, 0.6);
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
      async () => (await runtime.get(run.id))?.status === "completed",
      { timeout: 5_000 },
    );

    await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("unsubscribe", 0.99),
      },
      {
        workspace_id,
        external_id: `in-${randomUUID()}`,
        in_reply_to: ses.lastExternalId ?? "",
        from: { email: "anne@acme.ai" },
        subject: "stop",
        body_text: "Please take me off your list.",
        received_at: new Date().toISOString(),
      },
    );

    await until(async () => {
      const top = await memory.procedural.topForPattern(
        { workspace_id, rep_id },
        pattern_key,
        3,
      );
      return top[0]?.loss_count === 1;
    }, { timeout: 5_000 });

    const top = await memory.procedural.topForPattern(
      { workspace_id, rep_id },
      pattern_key,
      3,
    );
    // unsubscribe delta = -0.30 → 0.5 - 0.30 = 0.2 (clamped within [0,1])
    assert.equal(top[0].id, seededExemplar.id);
    assert.equal(top[0].score, 0.2);
    assert.equal(top[0].loss_count, 1);
    assert.equal(top[0].win_count, 0);

    await wired.unsubscribe();
  } finally {
    await bus.close();
    await fx.close();
  }
});
