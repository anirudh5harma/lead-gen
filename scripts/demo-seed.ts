#!/usr/bin/env node
/**
 * Demo seed. Spins up a fresh workspace, seeds Sampark, ingests a Series A
 * funding signal, runs the cold-open Play (with mocked LLM + SES), and
 * simulates an inbound positive reply so the dashboard has real data to
 * show:
 *
 *   /dashboard               → morning brief with non-zero counts
 *   /dashboard/conversations → one open conversation
 *   /dashboard/conversations/<id> → message timeline + show-your-work
 *   /dashboard/reps          → Sampark with a positive_reply outcome
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
  createPostgresVerticalSliceStore,
} from "../core/plays/index.ts";
import { ingestManualSignal } from "../core/signals/index.ts";
import {
  bootstrapWorkspace,
  DEFAULT_PRODUCT_USER_ID,
  resetProductEngineForTests,
} from "../core/product/app.ts";
import type { GraphCompany, GraphPerson } from "../core/graph/types.ts";

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
  const demoUserId = process.env.BOMBSELL_DEMO_USER_ID ?? DEFAULT_PRODUCT_USER_ID;
  if (!process.env.BOMBSELL_DEMO_USER_ID) {
    console.warn(
      `BOMBSELL_DEMO_USER_ID is unset; using local demo user ${DEFAULT_PRODUCT_USER_ID}.`,
    );
  }
  const boot = await bootstrapWorkspace(pool, demoUserId, {
    workspace_id,
    workspace_slug: slug,
    workspace_name: "Demo Workspace",
    ensureMembership: true,
  });
  console.log(`workspace ${slug} (${workspace_id})`);

  const { rep_id, channel_account_id } = boot;
  const sendingDomain = (await pool.query<{
    id: string;
    domain: string;
  }>(
    `select id, domain::text as domain
       from sending_domains
      where workspace_id = $1 and channel_account_id = $2
      order by created_at asc
      limit 1`,
    [workspace_id, channel_account_id],
  )).rows[0];
  if (!sendingDomain) {
    throw new Error("Product bootstrap did not configure a sending domain.");
  }
  const sending_domain_id = sendingDomain.id;
  console.log(`Sampark rep_id=${rep_id}`);

  const bus = await createPostgresEventBus({ pool });

  const company_id = randomUUID();
  const person_id = randomUUID();
  const now = new Date().toISOString();
  const company: GraphCompany = {
    id: company_id,
    workspace_id,
    name: "Acme AI",
    domain: "acme.ai",
    industry: "fintech",
    size_bucket: null,
    description: null,
    properties: {},
    provenance: { source: "demo-seed" },
    embedded_at: null,
    created_at: now,
    updated_at: now,
  };
  const person: GraphPerson = {
    id: person_id,
    workspace_id,
    full_name: "Anne Brown",
    given_name: "Anne",
    family_name: "Brown",
    title: "CEO",
    company_id,
    emails: ["anne@acme.ai"],
    phones: [],
    linkedin_url: null,
    x_handle: null,
    properties: {},
    provenance: { source: "demo-seed" },
    embedded_at: null,
    created_at: now,
    updated_at: now,
  };
  const signal = await ingestManualSignal(
    {
      workspace_id,
      kind: "funding",
      title: "Acme AI raises $20M Series A",
      content: "TechCrunch reports Acme AI closed a $20M Series A led by Sequoia.",
      url: "https://techcrunch.com/demo",
      icp_segment: "fintech-founder",
      match_score: 0.92,
      company,
      person,
    },
    {
      store: createPostgresVerticalSliceStore(pool),
      bus,
      producer_ref: "script:demo-seed",
    },
  );
  const signal_id = signal.id;
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
  await resetProductEngineForTests();
  await pool.end();

  void exemplar;
  console.log("");
  console.log("Open http://localhost:3000/dashboard");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
