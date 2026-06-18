import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupPg, until } from "./_pg.ts";
import {
  bootstrapWorkspace,
  claimRunnableWorkflowRuns,
  configureWorkspaceEmailAccount,
  configureSignalEmailPlay,
  DEFAULT_PRODUCT_USER_ID,
  dispatchSignalPlaysOnce,
  getProductEngine,
  getAppState,
  projectPendingProductEventsOnce,
  resetProductEngineForTests,
  renewWorkflowRunLeases,
  submitManualSignal,
} from "../core/product/app.ts";
import { resetPool, setPool } from "../core/substrate/storage/index.ts";
import {
  createDryRunEmailTransport,
  createFixedIntentClassifier,
  createPostgresOwnedDomainEmailChannel,
  handleInboundEmail,
} from "../core/channels/email/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";

const WORKFLOW_TIMEOUT_MS = 45_000;

test("product worker: dispatches signal.matched events into durable play runs", async (t) => {
  const fx = await setupPg("product_worker");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const submitted = await submitManualSignal({
      company_name: "Acme Payroll",
      company_domain: "acmepayroll.example",
      person_name: "Nisha Rao",
      person_email: "nisha@acmepayroll.example",
      signal_title: "Acme Payroll announced a Series A",
      signal_content:
        "Acme Payroll raised a Series A to expand finance workflows for distributed teams.",
      signal_url: "https://example.com/acme-series-a",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
    await seedVerifiedTopContactsForSignal(fx.pool, submitted, [
      {
        full_name: "Nisha Rao",
        title: "Founder and CEO",
        email: "nisha@acmepayroll.example",
      },
      {
        full_name: "Dev Mehta",
        title: "VP Revenue",
        email: "dev@acmepayroll.example",
      },
      {
        full_name: "Tara Singh",
        title: "Head of Growth",
        email: "tara@acmepayroll.example",
      },
    ]);

    assert.ok(submitted.signal_id);
    assert.equal(await dispatchSignalPlaysOnce(), 0);
    await waitForContactResolved(fx.pool, submitted);
    assert.equal(await dispatchSignalPlaysOnce(), 1);

    const run = await until(async () => {
      const { rows } = await fx.pool.query<{
        status: string;
        output: { outcome_id?: string } | null;
      }>(
        `select status, output
           from workflow_runs
          where idempotency_key = $1`,
        [`signal:${submitted.signal_id}:play:${boot.play_id}`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    }, { timeout: WORKFLOW_TIMEOUT_MS });
    assert.equal(run.status, "completed");
    assert.ok(run.output?.outcome_id);

    const channel = await fx.pool.query<{
      daily_used: number;
      message_account_id: string | null;
    }>(
      `select ca.daily_used,
              (select channel_account_id
                 from messages
                where workspace_id = ca.workspace_id
                order by created_at desc
                limit 1) as message_account_id
         from channel_accounts ca
        where ca.workspace_id = $1
        order by ca.created_at asc
        limit 1`,
      [submitted.workspace_id],
    );
    assert.equal(channel.rows[0].daily_used, 1);
    assert.ok(channel.rows[0].message_account_id);

    const outbound = await fx.pool.query<{
      external_id: string;
      conversation_id: string;
    }>(
      `select external_id, conversation_id
         from messages
        where workspace_id = $1
          and direction = 'outbound'
        order by created_at desc
        limit 1`,
      [submitted.workspace_id],
    );
    const inbound = {
      workspace_id: submitted.workspace_id,
      external_id: "reply_1",
      in_reply_to: outbound.rows[0].external_id,
      from: { email: "nisha@acmepayroll.example" },
      subject: "Re: congrats",
      body_text: "Sounds good, happy to book a meeting next week.",
      received_at: new Date().toISOString(),
    };
    const engine = await getProductEngine();
    const ingressEvent = await engine.bus.publish({
      workspace_id: submitted.workspace_id,
      event_type: "email.inbound.received",
      source: "webhook",
      producer_ref: "test:email:inbound",
      idempotency_key: "test:reply_1",
      payload: inbound,
    });
    const reply = await handleInboundEmail(
      {
        pool: fx.pool,
        bus: engine.bus,
        classifier: createFixedIntentClassifier("positive", 0.95),
        ingress_event_id: ingressEvent.id,
      },
      inbound,
    );
    assert.equal(reply.intent, "positive");
    assert.equal(reply.matched_conversation_id, outbound.rows[0].conversation_id);
    assert.ok(reply.outcome_id);

    const duplicate = await dispatchSignalPlaysOnce();
    assert.equal(duplicate, 0);

    const state = await getAppState(fx.pool);
    assert.equal(state.sendTraces[0].signal_title, "Acme Payroll announced a Series A");
    assert.equal(state.sendTraces[0].rep_name, "Outbound agent");
    assert.equal(state.sendTraces[0].eval_passed, true);
    assert.equal(state.sendTraces[0].workflow_status, "completed");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product worker: dispatch can target one active Play for a matched signal", async (t) => {
  const fx = await setupPg("product_worker_target_play");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const targeted = await configureSignalEmailPlay({
      rep_id: boot.rep_id,
      name: "Targeted Funding Signal Email",
      signal_kind: "funding",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
    const submitted = await submitManualSignal({
      company_name: "Targeted Payroll",
      company_domain: "targetedpayroll.example",
      person_name: "Rhea Menon",
      person_email: "rhea@targetedpayroll.example",
      signal_title: "Targeted Payroll announced a Series A",
      signal_content:
        "Targeted Payroll raised a Series A to expand finance workflows for distributed teams.",
      signal_url: "https://example.com/targeted-series-a",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
    await seedVerifiedTopContactsForSignal(fx.pool, submitted, [
      {
        full_name: "Rhea Menon",
        title: "Founder and CEO",
        email: "rhea@targetedpayroll.example",
      },
      {
        full_name: "Karan Bose",
        title: "VP Revenue",
        email: "karan@targetedpayroll.example",
      },
      {
        full_name: "Ira Shah",
        title: "Head of Growth",
        email: "ira@targetedpayroll.example",
      },
    ]);

    assert.equal(
      await dispatchSignalPlaysOnce({
        signal_id: submitted.signal_id,
        play_id: targeted.play_id,
      }),
      0,
    );
    await waitForContactResolved(fx.pool, submitted, targeted.play_id);
    assert.equal(
      await dispatchSignalPlaysOnce({
        signal_id: submitted.signal_id,
        play_id: targeted.play_id,
      }),
      1,
    );

    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status
           from workflow_runs
          where workspace_id = $1
            and idempotency_key = $2`,
        [submitted.workspace_id, `signal:${submitted.signal_id}:play:${targeted.play_id}`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    }, { timeout: WORKFLOW_TIMEOUT_MS });

    const runs = await fx.pool.query<{ idempotency_key: string }>(
      `select idempotency_key
         from workflow_runs
        where workspace_id = $1
          and idempotency_key in ($2, $3, $4, $5)
        order by idempotency_key asc`,
      [
        submitted.workspace_id,
        `contact:${submitted.signal_id}:play:${boot.play_id}:channel:email`,
        `signal:${submitted.signal_id}:play:${boot.play_id}`,
        `contact:${submitted.signal_id}:play:${targeted.play_id}:channel:email`,
        `signal:${submitted.signal_id}:play:${targeted.play_id}`,
      ],
    );
    assert.deepEqual(
      runs.rows.map((row) => row.idempotency_key),
      [
        `contact:${submitted.signal_id}:play:${targeted.play_id}:channel:email`,
        `signal:${submitted.signal_id}:play:${targeted.play_id}`,
      ],
    );
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product worker: repairs failed no-draft Signal Play runs", async (t) => {
  const fx = await setupPg("product_worker_signal_play_repair");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const submitted = await submitManualSignal({
      company_name: "Recoverable Payroll",
      company_domain: "recoverablepayroll.example",
      person_name: "Sana Iyer",
      person_email: "sana@recoverablepayroll.example",
      signal_title: "Recoverable Payroll announced a Series A",
      signal_content:
        "Recoverable Payroll raised a Series A to expand finance workflows for distributed teams.",
      signal_url: "https://example.com/recoverable-series-a",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
    await seedVerifiedTopContactsForSignal(fx.pool, submitted, [
      {
        full_name: "Sana Iyer",
        title: "Founder and CEO",
        email: "sana@recoverablepayroll.example",
      },
      {
        full_name: "Omar Kapur",
        title: "VP Revenue",
        email: "omar@recoverablepayroll.example",
      },
      {
        full_name: "Lina Shah",
        title: "Head of Growth",
        email: "lina@recoverablepayroll.example",
      },
    ]);

    assert.equal(await dispatchSignalPlaysOnce({ signal_id: submitted.signal_id }), 0);
    await waitForContactResolved(fx.pool, submitted, boot.play_id);
    await fx.pool.query(
      `insert into workflow_runs (
         id, workspace_id, workflow_name, workflow_version, status, input, error,
         play_id, play_run_id, idempotency_key, started_at, ended_at, created_at
       ) values (
         $1, $2, 'play.signal_to_email.v1', '1', 'failed', $3::jsonb, $4::jsonb,
         $5, $6, $7, now() - interval '10 minutes', now() - interval '9 minutes', now() - interval '10 minutes'
       )`,
      [
        randomUUID(),
        submitted.workspace_id,
        JSON.stringify({
          workspace_id: submitted.workspace_id,
          play_id: boot.play_id,
          play_run_id: randomUUID(),
          rep_id: boot.rep_id,
          signal_id: submitted.signal_id,
        }),
        JSON.stringify({ message: "Exa daily_query_cap_exhausted exceeded" }),
        boot.play_id,
        randomUUID(),
        `signal:${submitted.signal_id}:play:${boot.play_id}`,
      ],
    );

    assert.equal(await dispatchSignalPlaysOnce({ signal_id: submitted.signal_id }), 1);
    const repairRun = await until(async () => {
      const { rows } = await fx.pool.query<{ status: string; idempotency_key: string }>(
        `select status, idempotency_key
           from workflow_runs
          where workspace_id = $1
            and idempotency_key = $2`,
        [
          submitted.workspace_id,
          `signal:${submitted.signal_id}:play:${boot.play_id}:repair:draft-grounding-skip-v1`,
        ],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    }, { timeout: WORKFLOW_TIMEOUT_MS });
    assert.equal(
      repairRun.idempotency_key,
      `signal:${submitted.signal_id}:play:${boot.play_id}:repair:draft-grounding-skip-v1`,
    );

    const messages = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from messages m
         join conversations c on c.id = m.conversation_id
        where m.workspace_id = $1
          and c.origin_signal_id = $2
          and c.properties->>'play_id' = $3`,
      [submitted.workspace_id, submitted.signal_id, boot.play_id],
    );
    assert.equal(messages.rows[0]?.count, "1");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product worker: repairs stale deferred contact resolver before email dispatch", async (t) => {
  const fx = await setupPg("product_worker_contact_repair");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  await withoutExternalContactProviders(async () => {
    try {
      const boot = await bootstrapWorkspace(fx.pool);
      const submitted = await submitManualSignal({
        company_name: "Repair Analytics",
        company_domain: "repairanalytics.example",
        person_name: "Ava Founder",
        person_email: "ava@repairanalytics.example",
        signal_title: "Repair Analytics is hiring a GTM lead",
        signal_content: "Repair Analytics is hiring a GTM lead after a launch week spike.",
        signal_url: "https://example.com/repair-gtm",
        approval: "none",
      }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
      const company = await fx.pool.query<{ company_id: string }>(
        `select related_company_id::text as company_id
           from signals
          where workspace_id = $1
            and id = $2`,
        [submitted.workspace_id, submitted.signal_id],
      );
      const companyId = company.rows[0]?.company_id;
      assert.ok(companyId);

      const staleRunId = randomUUID();
      const staleInput = {
        workspace_id: submitted.workspace_id,
        signal_id: submitted.signal_id,
        company_id: companyId,
        play_id: boot.play_id,
        rep_id: boot.rep_id,
        channel: "email",
        trigger_event_id: null,
      };
      await fx.pool.query(
        `insert into workflow_runs (
           id, workspace_id, workflow_name, workflow_version, status, input, output,
           idempotency_key, started_at, ended_at, created_at
         ) values (
           $1, $2, 'contact.resolve_for_signal.v1', '1', 'completed',
           $3::jsonb, $4::jsonb, $5, now() - interval '1 hour',
           now() - interval '59 minutes', now() - interval '1 hour'
         )`,
        [
          staleRunId,
          submitted.workspace_id,
          JSON.stringify(staleInput),
          JSON.stringify({
            decision: "deferred",
            contact_resolution_id: randomUUID(),
            candidates: [],
            selected_person_id: null,
            defer_reason: "no_email_ready_contact",
          }),
          `contact:${submitted.signal_id}:play:${boot.play_id}:channel:email`,
        ],
      );

      const repairedPersonId = await seedVerifiedGraphContact(fx.pool, {
        workspace_id: submitted.workspace_id,
        company_id: companyId,
        full_name: "Ava Founder",
        title: "Founder and CEO",
        email: "ava@repairanalytics.example",
      });

      assert.equal(await dispatchSignalPlaysOnce({ signal_id: submitted.signal_id }), 0);
      await waitForContactResolved(fx.pool, submitted);

      const repairRun = await fx.pool.query<{
        status: string;
        output: { selected_person_id?: string | null; candidates?: unknown[] } | null;
      }>(
        `select status, output
           from workflow_runs
          where workspace_id = $1
            and idempotency_key = $2`,
        [
          submitted.workspace_id,
          `contact:${submitted.signal_id}:play:${boot.play_id}:channel:email:repair:verified-contact-v2`,
        ],
      );
      assert.equal(repairRun.rows.length, 1);
      assert.equal(repairRun.rows[0].status, "completed");
      assert.equal(repairRun.rows[0].output?.selected_person_id, repairedPersonId);
      assert.equal(repairRun.rows[0].output?.candidates?.length, 1);

      assert.equal(await dispatchSignalPlaysOnce({ signal_id: submitted.signal_id }), 1);
      await until(async () => {
        const { rows } = await fx.pool.query<{ status: string }>(
          `select status
             from workflow_runs
            where workspace_id = $1
              and idempotency_key = $2`,
          [submitted.workspace_id, `signal:${submitted.signal_id}:play:${boot.play_id}`],
        );
        return rows[0]?.status === "completed" ? rows[0] : null;
      }, { timeout: WORKFLOW_TIMEOUT_MS });
    } finally {
      await resetProductEngineForTests();
      await fx.close();
      await resetPool();
    }
  });
});

test("product worker: resolves top graph contacts before dispatching an email Play", async (t) => {
  const fx = await setupPg("product_worker_contact_resolver");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const submitted = await submitManualSignal({
      company_name: "Resolver Payroll",
      company_domain: "resolverpayroll.example",
      person_name: "Seed Person",
      person_email: "seed@resolverpayroll.example",
      signal_title: "Resolver Payroll announced a Series A",
      signal_content:
        "Resolver Payroll raised a Series A to expand finance workflows for distributed teams.",
      signal_url: "https://example.com/resolver-series-a",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
    const company = await fx.pool.query<{ company_id: string }>(
      `select related_company_id::text as company_id
         from signals
        where id = $1
          and workspace_id = $2`,
      [submitted.signal_id, submitted.workspace_id],
    );
    const companyId = company.rows[0]?.company_id;
    assert.ok(companyId);
    const founderId = await seedVerifiedGraphContact(fx.pool, {
      workspace_id: submitted.workspace_id,
      company_id: companyId,
      full_name: "Ava Founder",
      title: "Founder and CEO",
      email: "ava@resolverpayroll.example",
    });
    await seedVerifiedGraphContact(fx.pool, {
      workspace_id: submitted.workspace_id,
      company_id: companyId,
      full_name: "Ben Revenue",
      title: "VP Revenue",
      email: "ben@resolverpayroll.example",
    });
    await seedVerifiedGraphContact(fx.pool, {
      workspace_id: submitted.workspace_id,
      company_id: companyId,
      full_name: "Cara Growth",
      title: "Head of Growth",
      email: "cara@resolverpayroll.example",
    });

    assert.equal(await dispatchSignalPlaysOnce(), 0);

    const resolved = await until(async () => {
      const { rows } = await fx.pool.query<{
        payload: {
          selected_person_id: string;
          provider_order: string[];
          candidates: Array<{
            full_name: string;
            person_id: string;
            verification: { email_verified?: boolean };
          }>;
        };
      }>(
        `select payload
           from events
          where workspace_id = $1
            and event_type = 'contact.resolved'
            and payload->>'signal_id' = $2
          order by occurred_at desc
          limit 1`,
        [submitted.workspace_id, submitted.signal_id],
      );
      return rows[0] ?? null;
    }, { timeout: WORKFLOW_TIMEOUT_MS });
    assert.equal(resolved.payload.selected_person_id, founderId);
    assert.deepEqual(resolved.payload.provider_order, ["graph_cache"]);
    assert.deepEqual(
      resolved.payload.candidates.map((candidate) => candidate.full_name),
      ["Ava Founder", "Ben Revenue", "Cara Growth"],
    );
    assert.equal(
      resolved.payload.candidates.every((candidate) =>
        candidate.verification.email_verified === true
      ),
      true,
    );

    assert.equal(await dispatchSignalPlaysOnce(), 1);

    let emailRun: { status: string; error: { message?: string } | null };
    try {
      emailRun = await until(async () => {
        const { rows } = await fx.pool.query<{
          status: string;
          error: { message?: string } | null;
        }>(
          `select status, error from workflow_runs where idempotency_key = $1`,
          [`signal:${submitted.signal_id}:play:${boot.play_id}`],
        );
        return rows[0] && rows[0].status !== "running"
          ? rows[0]
          : null;
      }, { timeout: WORKFLOW_TIMEOUT_MS });
    } catch (error) {
      const trace = await fx.pool.query<{
        workflow_name: string;
        run_status: string;
        step_name: string | null;
        step_status: string | null;
        step_error: { message?: string } | null;
      }>(
        `select wr.workflow_name,
                wr.status as run_status,
                ws.step_name,
                ws.status as step_status,
                ws.error as step_error
           from workflow_runs wr
           left join workflow_steps ws on ws.run_id = wr.id
          where wr.workspace_id = $1
          order by wr.created_at asc, ws.step_position asc, ws.attempt asc`,
        [submitted.workspace_id],
      );
      assert.fail(`${error instanceof Error ? error.message : String(error)}; workflow trace=${JSON.stringify(trace.rows)}`);
    }
    assert.equal(emailRun.status, "completed", emailRun.error?.message);

    const conversation = await fx.pool.query<{ counterparty_person_id: string }>(
      `select counterparty_person_id::text
         from conversations
        where workspace_id = $1
          and origin_signal_id = $2
          and counterparty_person_id = $3
        order by last_activity_at desc
        limit 1`,
      [submitted.workspace_id, submitted.signal_id, founderId],
    );
    assert.equal(conversation.rows[0]?.counterparty_person_id, founderId);

    const workflowRows = await fx.pool.query<{ workflow_name: string; status: string }>(
      `select workflow_name, status
         from workflow_runs
        where workspace_id = $1
          and idempotency_key in ($2, $3)
        order by workflow_name asc`,
      [
        submitted.workspace_id,
        `contact:${submitted.signal_id}:play:${boot.play_id}:channel:email`,
        `signal:${submitted.signal_id}:play:${boot.play_id}`,
      ],
    );
    assert.deepEqual(
      workflowRows.rows.map((row) => [row.workflow_name, row.status]),
      [
        ["contact.resolve_for_signal.v1", "completed"],
        ["play.signal_to_email.v1", "completed"],
      ],
    );
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product worker: repairs company-less matched signals before contact dispatch", async (t) => {
  const fx = await setupPg("product_worker_company_repair");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  await withoutExternalContactProviders(async () => {
    try {
      const boot = await bootstrapWorkspace(fx.pool);
      const sourceId = randomUUID();
      await fx.pool.query(
        `insert into graph_sources (id, workspace_id, kind, name, config)
         values ($1, $2, 'web_monitor', 'HN Who''s Hiring', $3::jsonb)`,
        [
          sourceId,
          boot.workspace_id,
          JSON.stringify({
            adapter: "hn_whos_hiring",
            kind: "funding",
            provider: "hacker_news",
          }),
        ],
      );
      const signalId = randomUUID();
      await fx.pool.query(
        `insert into signals (
           id, workspace_id, source_id, kind, title, content, url,
           freshness_at, status, properties, provenance, ingested_at
         ) values (
           $1, $2, $3, 'funding', $4, $5, $6,
           $7, 'matched', $8::jsonb, $9::jsonb, now()
         )`,
        [
          signalId,
          boot.workspace_id,
          sourceId,
          "Wrenly | Founding Customer Success Manager | SF | https://www.wrenly.ai/hiring/csm",
          "We are hiring a founding CSM to work with early design partners.",
          "https://news.ycombinator.com/item?id=1",
          "2026-06-12T00:00:00.000Z",
          JSON.stringify({ structured: { thread_id: "1", author: "founder" } }),
          JSON.stringify({ adapter: "hn_whos_hiring", external_id: "hn-hiring-1" }),
        ],
      );

      const engine = await getProductEngine();
      await engine.bus.publish({
        workspace_id: boot.workspace_id,
        event_type: "signal.matched",
        source: "system",
        producer_ref: "test:company-repair",
        idempotency_key: `test:company-repair:${signalId}`,
        payload: {
          signal_id: signalId,
          match_score: 0.91,
          icp_segment: "default",
        },
      });

      assert.equal(await dispatchSignalPlaysOnce({ limit: 5 }), 0);

      const linked = await fx.pool.query<{
        related_company_id: string | null;
        company_name: string | null;
        company_domain: string | null;
      }>(
        `select s.related_company_id::text as related_company_id,
                gc.name as company_name,
                gc.domain as company_domain
           from signals s
           left join graph_companies gc on gc.id = s.related_company_id
          where s.workspace_id = $1
            and s.id = $2`,
        [boot.workspace_id, signalId],
      );
      assert.ok(linked.rows[0]?.related_company_id);
      assert.equal(linked.rows[0].company_name, "Wrenly");
      assert.equal(linked.rows[0].company_domain, "wrenly.ai");

      const resolver = await fx.pool.query<{ workflow_name: string; status: string }>(
        `select workflow_name, status
           from workflow_runs
          where workspace_id = $1
            and idempotency_key = $2`,
        [
          boot.workspace_id,
          `contact:${signalId}:play:${boot.play_id}:channel:email`,
        ],
      );
      assert.equal(resolver.rows.length, 1);
      assert.equal(resolver.rows[0].workflow_name, "contact.resolve_for_signal.v1");
      assert.match(resolver.rows[0].status, /^(running|completed)$/);
    } finally {
      await resetProductEngineForTests();
      await fx.close();
      await resetPool();
    }
  });
});

test("product worker: deliverability cap defers sends without consuming volume", async (t) => {
  const fx = await setupPg("product_deliverability");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    await projectPendingProductEventsOnce();
    await configureWorkspaceEmailAccount(
      {
        display_name: "founder@bombsell.test",
        daily_cap: 0,
      },
      { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID },
    );
    const submitted = await submitManualSignal({
      company_name: "Beta Finance",
      company_domain: "betafinance.example",
      person_name: "Mira Shah",
      person_email: "mira@betafinance.example",
      signal_title: "Beta Finance raised a seed round",
      signal_content: "Beta Finance raised a seed round for compliance automation.",
      signal_url: "https://example.com/beta-seed",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
    await seedVerifiedTopContactsForSignal(fx.pool, submitted, [
      {
        full_name: "Mira Shah",
        title: "Founder and CEO",
        email: "mira@betafinance.example",
      },
      {
        full_name: "Neel Rao",
        title: "VP Revenue",
        email: "neel@betafinance.example",
      },
      {
        full_name: "Pia Iyer",
        title: "Head of Growth",
        email: "pia@betafinance.example",
      },
    ]);

    assert.equal(await dispatchSignalPlaysOnce(), 0);
    await waitForContactResolved(fx.pool, submitted);
    assert.equal(await dispatchSignalPlaysOnce(), 1);
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status from workflow_runs where idempotency_key like $1`,
        [`signal:${submitted.signal_id}:%`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    }, { timeout: WORKFLOW_TIMEOUT_MS });

    const message = await fx.pool.query<{
      status: string;
      properties: { defer_reason?: string };
    }>(
      `select status, properties
         from messages
        where workspace_id = $1
        order by created_at desc
        limit 1`,
      [submitted.workspace_id],
    );
    assert.equal(message.rows[0].status, "deferred");
    assert.equal(message.rows[0].properties.defer_reason, "deliverability_cap_zero");

    const account = await fx.pool.query<{ daily_used: number }>(
      `select daily_used from channel_accounts where id = $1`,
      [boot.channel_account_id],
    );
    assert.equal(account.rows[0].daily_used, 0);
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

async function seedVerifiedGraphContact(
  pool: TestPool,
  input: {
    workspace_id: string;
    company_id: string;
    full_name: string;
    title: string;
    email: string;
  },
): Promise<string> {
  const id = randomUUID();
  const verification = {
    email_verification: {
      [input.email.toLowerCase()]: {
        provider: "test",
        status: "valid",
        verified: true,
        checked_at: new Date().toISOString(),
      },
    },
  };
  const { rows } = await pool.query<{ id: string }>(
    `insert into graph_persons (
       id, workspace_id, full_name, title, company_id, emails, properties, provenance
     ) values (
       $1, $2, $3, $4, $5, array[$6]::citext[], $7::jsonb, $8::jsonb
     )
     returning id::text as id`,
    [
      id,
      input.workspace_id,
      input.full_name,
      input.title,
      input.company_id,
      input.email,
      JSON.stringify(verification),
      JSON.stringify({ source: "test:verified-contact" }),
    ],
  );
  return rows[0]!.id;
}

interface TestPool {
  query<T = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

async function seedVerifiedTopContactsForSignal(
  pool: TestPool,
  submitted: { workspace_id: string; signal_id: string },
  contacts: Array<{ full_name: string; title: string; email: string }>,
): Promise<void> {
  const company = await pool.query<{ company_id: string }>(
    `select related_company_id::text as company_id
       from signals
      where id = $1
        and workspace_id = $2`,
    [submitted.signal_id, submitted.workspace_id],
  );
  const companyId = company.rows[0]?.company_id;
  assert.ok(companyId);
  for (const contact of contacts) {
    await seedVerifiedGraphContact(pool, {
      workspace_id: submitted.workspace_id,
      company_id: companyId,
      ...contact,
    });
  }
}

async function waitForContactResolved(
  pool: TestPool,
  submitted: { workspace_id: string; signal_id: string },
  play_id?: string,
): Promise<void> {
  await until(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `select id::text as id
         from events
        where workspace_id = $1
          and event_type = 'contact.resolved'
          and payload->>'signal_id' = $2
          and ($3::text is null or payload->>'play_id' = $3)
        order by occurred_at desc
        limit 1`,
      [submitted.workspace_id, submitted.signal_id, play_id ?? null],
    );
    return rows[0] ?? null;
  }, { timeout: WORKFLOW_TIMEOUT_MS });
}

async function withoutExternalContactProviders<T>(fn: () => Promise<T>): Promise<T> {
  const keys = [
    "EXA_API_KEY",
    "HUNTER_API_KEY",
    "ZEROBOUNCE_API_KEY",
  ] as const;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    process.env[key] = "";
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("product worker: recipient frequency cap defers repeat outreach", async (t) => {
  const fx = await setupPg("product_frequency_cap");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const first = await submitManualSignal({
      company_name: "Gamma Security",
      company_domain: "gammasecurity.example",
      person_name: "Isha Mehta",
      person_email: "isha@gammasecurity.example",
      signal_title: "Gamma Security launched a SOC workflow",
      signal_content: "Gamma Security launched a new SOC automation workflow.",
      signal_url: "https://example.com/gamma-launch",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
    await seedVerifiedTopContactsForSignal(fx.pool, first, [
      {
        full_name: "Isha Mehta",
        title: "Founder and CEO",
        email: "isha@gammasecurity.example",
      },
      {
        full_name: "Arjun Nair",
        title: "VP Revenue",
        email: "arjun@gammasecurity.example",
      },
      {
        full_name: "Leela Jain",
        title: "Head of Growth",
        email: "leela@gammasecurity.example",
      },
    ]);

    assert.equal(await dispatchSignalPlaysOnce(), 0);
    await waitForContactResolved(fx.pool, first);
    assert.equal(await dispatchSignalPlaysOnce(), 1);
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status from workflow_runs where idempotency_key like $1`,
        [`signal:${first.signal_id}:%`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    }, { timeout: WORKFLOW_TIMEOUT_MS });

    const second = await submitManualSignal({
      company_name: "Gamma Security",
      company_domain: "gammasecurity.example",
      person_name: "Isha Mehta",
      person_email: "isha@gammasecurity.example",
      signal_title: "Gamma Security hired a VP Sales",
      signal_content: "Gamma Security hired a VP Sales for enterprise expansion.",
      signal_url: "https://example.com/gamma-vp-sales",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });

    assert.equal(await dispatchSignalPlaysOnce(), 0);
    await waitForContactResolved(fx.pool, second);
    assert.equal(await dispatchSignalPlaysOnce(), 1);
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status from workflow_runs where idempotency_key like $1`,
        [`signal:${second.signal_id}:%`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    }, { timeout: WORKFLOW_TIMEOUT_MS });

    const messages = await fx.pool.query<{
      status: string;
      properties: { defer_reason?: string };
    }>(
      `select status, properties
         from messages
        where workspace_id = $1
          and direction = 'outbound'
        order by created_at asc`,
      [first.workspace_id],
    );
    assert.equal(messages.rows.length, 2);
    assert.equal(messages.rows[0].status, "sent");
    assert.equal(messages.rows[1].status, "deferred");
    assert.equal(messages.rows[1].properties.defer_reason, "recipient_frequency_cap");

    const account = await fx.pool.query<{ daily_used: number }>(
      `select daily_used from channel_accounts where id = $1`,
      [boot.channel_account_id],
    );
    assert.equal(account.rows[0].daily_used, 1);
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product email: queued send replay reuses reservation and transport idempotency", async (t) => {
  const fx = await setupPg("product_email_replay");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const submitted = await submitManualSignal({
      company_name: "Delta Treasury",
      company_domain: "deltatreasury.example",
      person_name: "Riya Kapoor",
      person_email: "riya@deltatreasury.example",
      signal_title: "Delta Treasury announced funding",
      signal_content: "Delta Treasury raised funding to expand treasury operations.",
      signal_url: "https://example.com/delta-funding",
      approval: "none",
    }, { workspace_id: boot.workspace_id, user_id: DEFAULT_PRODUCT_USER_ID });
    await seedVerifiedTopContactsForSignal(fx.pool, submitted, [
      {
        full_name: "Riya Kapoor",
        title: "Founder and CEO",
        email: "riya@deltatreasury.example",
      },
      {
        full_name: "Kabir Sethi",
        title: "VP Revenue",
        email: "kabir@deltatreasury.example",
      },
      {
        full_name: "Nora Bose",
        title: "Head of Growth",
        email: "nora@deltatreasury.example",
      },
    ]);
    assert.equal(await dispatchSignalPlaysOnce(), 0);
    await waitForContactResolved(fx.pool, submitted);
    assert.equal(await dispatchSignalPlaysOnce(), 1);
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status from workflow_runs where idempotency_key like $1`,
        [`signal:${submitted.signal_id}:%`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    }, { timeout: WORKFLOW_TIMEOUT_MS });

    const { rows } = await fx.pool.query<{
      id: string;
      conversation_id: string;
      rep_id: string;
      counterparty_person_id: string;
      subject: string | null;
      body: string;
      channel_account_id: string | null;
    }>(
      `select m.id, m.conversation_id, c.rep_id, c.counterparty_person_id,
              m.channel_account_id,
              m.subject, m.body
         from messages m
         join conversations c on c.id = m.conversation_id
        where m.workspace_id = $1 and m.direction = 'outbound'
        order by m.created_at desc
        limit 1`,
      [submitted.workspace_id],
    );
    const message = rows[0];
    const replayAccountId = message.channel_account_id ?? boot.channel_account_id;
    await fx.pool.query(
      `update messages
          set status = 'queued',
              external_id = null,
              channel_account_id = $2,
              properties = properties || jsonb_build_object(
                'send_reserved_at',
                now()::text
              )
        where id = $1`,
      [message.id, replayAccountId],
    );
    const before = await fx.pool.query<{ daily_used: number }>(
      `select daily_used from channel_accounts where id = $1`,
      [replayAccountId],
    );

    const transport = createDryRunEmailTransport();
    const email = createPostgresOwnedDomainEmailChannel({
      pool: fx.pool,
      transport,
    });
    const bus = createInMemoryEventBus();
    const conversation = {
      id: message.conversation_id,
      workspace_id: submitted.workspace_id,
      rep_id: message.rep_id,
      counterparty_person_id: message.counterparty_person_id,
      counterparty_email: "riya@deltatreasury.example",
    };
    const draft = {
      message_id: message.id,
      channel: "email",
      subject: message.subject,
      body: message.body,
      eval_passed: true,
    };

    const firstRetry = await email.send(conversation, draft, {
      workspace_id: submitted.workspace_id,
      bus,
    });
    const secondRetry = await email.send(conversation, draft, {
      workspace_id: submitted.workspace_id,
      bus,
    });

    assert.equal(firstRetry.status, "sent");
    assert.equal(secondRetry.status, "sent");
    assert.equal(
      firstRetry.status === "sent" ? firstRetry.external_id : null,
      secondRetry.status === "sent" ? secondRetry.external_id : null,
    );
    assert.equal(transport.sent.length, 1);
    assert.deepEqual(
      bus.published.map((event) => event.event_type),
      ["message.queued", "message.sent"],
    );
    const after = await fx.pool.query<{ daily_used: number }>(
      `select daily_used from channel_accounts where id = $1`,
      [replayAccountId],
    );
    assert.equal(after.rows[0].daily_used, before.rows[0].daily_used);

    await fx.pool.query(
      `update messages
          set status = 'queued',
              external_id = null,
              channel_account_id = $2,
              properties = properties || jsonb_build_object(
            'send_reserved_at',
            (now() - interval '24 hours')::text
          )
        where id = $1`,
      [message.id, replayAccountId],
    );
    const expiredRetry = await email.send(conversation, draft, {
      workspace_id: submitted.workspace_id,
      bus,
    });
    assert.equal(expiredRetry.status, "deferred");
    assert.equal(
      expiredRetry.status === "deferred" ? expiredRetry.defer_reason : null,
      "transport_idempotency_window_expired",
    );
    assert.equal(transport.sent.length, 1);
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product worker: workflow resume leases are claimed and renewed", async (t) => {
  const fx = await setupPg("product_worker_leases");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const workflowName = "test.worker_lease.v1";
    const firstRunId = randomUUID();
    const secondRunId = randomUUID();
    const completedRunId = randomUUID();
    await fx.pool.query(
      `insert into workflow_runs (
         id, workspace_id, workflow_name, workflow_version, status, input, created_at
       ) values
         ($1, $4, $5, '1', 'awaiting_event', '{}'::jsonb, now() - interval '2 minutes'),
         ($2, $4, $5, '1', 'running', '{}'::jsonb, now() - interval '1 minute'),
         ($3, $4, $5, '1', 'completed', '{}'::jsonb, now())`,
      [firstRunId, secondRunId, completedRunId, boot.workspace_id, workflowName],
    );

    const firstClaim = await claimRunnableWorkflowRuns(fx.pool, {
      workflowNames: [workflowName],
      limit: 1,
      leaseOwner: "worker-a",
      leaseMs: 60_000,
    });
    assert.deepEqual(firstClaim.map((row) => row.id), [firstRunId]);

    const secondClaim = await claimRunnableWorkflowRuns(fx.pool, {
      workflowNames: [workflowName],
      limit: 10,
      leaseOwner: "worker-b",
      leaseMs: 60_000,
    });
    assert.deepEqual(secondClaim.map((row) => row.id), [secondRunId]);

    const noClaim = await claimRunnableWorkflowRuns(fx.pool, {
      workflowNames: [workflowName],
      limit: 10,
      leaseOwner: "worker-c",
      leaseMs: 60_000,
    });
    assert.equal(noClaim.length, 0);

    assert.equal(
      await renewWorkflowRunLeases(fx.pool, {
        workflowNames: [workflowName],
        leaseOwner: "worker-a",
        leaseMs: 60_000,
      }),
      1,
    );

    await fx.pool.query(
      `update workflow_runs
          set lease_expires_at = now() - interval '1 second'
        where id = $1`,
      [firstRunId],
    );
    const recoveredClaim = await claimRunnableWorkflowRuns(fx.pool, {
      workflowNames: [workflowName],
      limit: 10,
      leaseOwner: "worker-c",
      leaseMs: 60_000,
    });
    assert.deepEqual(recoveredClaim.map((row) => row.id), [firstRunId]);

    const leases = await fx.pool.query<{ id: string; lease_owner: string | null }>(
      `select id, lease_owner
         from workflow_runs
        where id = any($1::uuid[])
        order by created_at asc`,
      [[firstRunId, secondRunId, completedRunId]],
    );
    assert.deepEqual(
      leases.rows.map((row) => [row.id, row.lease_owner]),
      [
        [firstRunId, "worker-c"],
        [secondRunId, "worker-b"],
        [completedRunId, null],
      ],
    );
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});
