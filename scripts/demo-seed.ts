#!/usr/bin/env node
/**
 * Demo seed. Spins up a fresh workspace, seeds Maya, ingests a Series A
 * funding signal, runs the cold-open Play (with mocked LLM + SES), and
 * simulates an inbound positive reply so the dashboard has real data to
 * show:
 *
 *   /dashboard               → morning brief with non-zero counts
 *   /dashboard/conversations → one open conversation
 *   /dashboard/conversations/<id> → message timeline + show-your-work
 *   /dashboard/reps          → Maya with a positive_reply outcome
 *
 * Run: DATABASE_URL=... npm run demo:seed
 */

import { randomUUID } from "node:crypto";
import { createPool, getPool, setPool } from "../core/substrate/storage/pool.ts";
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
import {
  createFixedIntentClassifier,
  handleInboundEmail,
  type SesSender,
  type OutlookSender,
} from "../core/channels/email/index.ts";
import {
  createSeriesAColdOpenPlay,
  seedMayaForDemo,
} from "../core/plays/index.ts";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  setPool(createPool({ connectionString: url }));
  const pool = getPool();

  const slug = `demo-${Date.now().toString(36)}`;
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, slug, "Demo Workspace"],
  );
  console.log(`workspace ${slug} (${workspace_id})`);

  const { rep_id, channel_account_id, sending_domain_id } =
    await seedMayaForDemo(pool, workspace_id);
  console.log(`Maya rep_id=${rep_id}`);

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
       freshness_at, related_company_id, related_person_id, status, match_score
     ) values ($1, $2, 'funding', 'Acme AI raises $20M Series A',
               'TechCrunch reports Acme AI closed a $20M Series A led by Sequoia.',
               'https://techcrunch.com/demo',
               now(), $3, $4, 'matched', 0.92)`,
    [signal_id, workspace_id, company_id, person_id],
  );
  console.log(`signal seeded`);

  // Add a procedural exemplar so the writer has something to draw on and
  // the bridge has somewhere to land the outcome.
  const memory = {
    episodic: createPostgresEpisodicRepository({ pool }),
    semantic: createPostgresSemanticRepository({ pool }),
    procedural: createPostgresProceduralRepository({ pool }),
  };
  const pattern_key =
    "icp:fintech-founder|signal:funding|channel:email|stage:cold_open";
  const exemplar = await memory.procedural.add(
    { workspace_id, rep_id },
    {
      pattern_key,
      exemplar: { subject: "saw your series a", body: "..." },
      initial_score: 0.5,
    },
  );

  const bus = await createPostgresEventBus({ pool });
  const wired = await wireOutcomeFeedback({
    bus,
    procedural: memory.procedural,
    attribution: createPostgresOutcomeAttribution({ pool }),
  });

  const llm = {
    async complete() {
      return {
        content: JSON.stringify({
          subject: "saw your series a",
          body_text:
            "Anne — saw Sequoia led the round. Most founders at this stage punt on infra hires for a quarter and regret it. Worth a 15-min compare-notes?",
        }),
        model: "deepseek-v4-pro",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
  const ses: SesSender = {
    async send() {
      return { external_id: `ses-${randomUUID()}` };
    },
  };
  const outlook: OutlookSender = {
    async send() {
      throw new Error("not used");
    },
  };
  const judge = createNoopJudge(0.9, 0.6);
  const runtime = createPostgresWorkflowRuntime({ pool, bus });
  runtime.register(
    createSeriesAColdOpenPlay({
      pool,
      bus,
      llm,
      judge,
      memory,
      emailChannelDeps: { ses, outlook },
    }),
  );
  const run = await runtime.start({
    workspace_id,
    workflow_name: "series_a_cold_open",
    input: { signal_id, rep_id, person_id, channel_account_id, sending_domain_id },
  });
  // Wait for the workflow to finish.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const r = await runtime.get(run.id);
    if (r?.status === "completed" || r?.status === "failed") break;
    await new Promise((res) => setTimeout(res, 100));
  }
  const final = await runtime.get<unknown, {
    status: string;
    external_id?: string;
    conversation_id: string;
  }>(run.id);
  console.log(`workflow ${final?.status}`);

  // Simulate an inbound positive reply so the conversation has both
  // directions and procedural memory updates.
  const sentExternalId = (await pool.query<{ external_id: string | null }>(
    `select external_id from messages
      where workspace_id = $1 and conversation_id = $2 and direction = 'outbound'
      order by sent_at desc limit 1`,
    [workspace_id, final?.output?.conversation_id ?? ""],
  )).rows[0]?.external_id ?? "";

  await handleInboundEmail(
    {
      pool,
      bus,
      classifier: createFixedIntentClassifier("positive", 0.95),
    },
    {
      workspace_id,
      external_id: `in-${randomUUID()}`,
      in_reply_to: sentExternalId,
      from: { email: "anne@acme.ai", name: "Anne Brown" },
      subject: "Re: saw your series a",
      body_text: "Yes — Tuesday 3pm works. Send a link.",
      received_at: new Date().toISOString(),
    },
  );
  console.log(`positive reply simulated`);

  // Drain the bridge.
  await new Promise((r) => setTimeout(r, 300));
  await wired.unsubscribe();
  await bus.close();
  await pool.end();

  void exemplar;
  console.log("");
  console.log(`Open http://localhost:3000/dashboard?ws=${workspace_id}`);
  console.log(`(set the cookie: bs_ws=${workspace_id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
