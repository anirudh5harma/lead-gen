import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupPg, until } from "./_pg.ts";
import {
  bootstrapWorkspace,
  claimRunnableWorkflowRuns,
  dispatchSignalPlaysOnce,
  getAppState,
  resetProductEngineForTests,
  renewWorkflowRunLeases,
  submitManualSignal,
} from "../core/product/app.ts";
import { recordInboundEmailReply } from "../core/product/inbound.ts";
import { resetPool, setPool } from "../core/substrate/storage/index.ts";
import {
  createDryRunEmailTransport,
  createPostgresOwnedDomainEmailChannel,
} from "../core/channels/email/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";

test("product worker: dispatches signal.matched events into durable play runs", async (t) => {
  const fx = await setupPg("product_worker");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    await bootstrapWorkspace(fx.pool);
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
    });

    assert.ok(submitted.signal_id);
    const dispatched = await dispatchSignalPlaysOnce();
    assert.equal(dispatched, 1);

    const run = await until(async () => {
      const { rows } = await fx.pool.query<{
        status: string;
        output: { outcome_id?: string } | null;
      }>(
        `select status, output
           from workflow_runs
          where idempotency_key = $1`,
        [`signal:${submitted.signal_id}:play:${(await bootstrapWorkspace(fx.pool)).play_id}`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    });
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
    const reply = await recordInboundEmailReply({
      workspace_id: submitted.workspace_id,
      in_reply_to_external_id: outbound.rows[0].external_id,
      external_id: "reply_1",
      from_email: "nisha@acmepayroll.example",
      subject: "Re: congrats",
      body: "Sounds good, happy to book a meeting next week.",
    });
    assert.equal(reply.intent, "positive");
    assert.equal(reply.conversation_id, outbound.rows[0].conversation_id);
    assert.ok(reply.outcome_id);

    const duplicate = await dispatchSignalPlaysOnce();
    assert.equal(duplicate, 0);

    const state = await getAppState(fx.pool);
    assert.equal(state.sendTraces[0].signal_title, "Acme Payroll announced a Series A");
    assert.equal(state.sendTraces[0].rep_name, "Maya");
    assert.equal(state.sendTraces[0].eval_passed, true);
    assert.equal(state.sendTraces[0].workflow_status, "completed");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product worker: deliverability cap defers sends without consuming volume", async (t) => {
  const fx = await setupPg("product_deliverability");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    await fx.pool.query(
      `update channel_accounts set daily_cap = 0, daily_used = 0 where id = $1`,
      [boot.channel_account_id],
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
    });

    assert.equal(await dispatchSignalPlaysOnce(), 1);
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status from workflow_runs where idempotency_key like $1`,
        [`signal:${submitted.signal_id}:%`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    });

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
    });

    assert.equal(await dispatchSignalPlaysOnce(), 1);
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status from workflow_runs where idempotency_key like $1`,
        [`signal:${first.signal_id}:%`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    });

    const second = await submitManualSignal({
      company_name: "Gamma Security",
      company_domain: "gammasecurity.example",
      person_name: "Isha Mehta",
      person_email: "isha@gammasecurity.example",
      signal_title: "Gamma Security hired a VP Sales",
      signal_content: "Gamma Security hired a VP Sales for enterprise expansion.",
      signal_url: "https://example.com/gamma-vp-sales",
      approval: "none",
    });

    assert.equal(await dispatchSignalPlaysOnce(), 1);
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status from workflow_runs where idempotency_key like $1`,
        [`signal:${second.signal_id}:%`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    });

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
    });
    assert.equal(await dispatchSignalPlaysOnce(), 1);
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status from workflow_runs where idempotency_key like $1`,
        [`signal:${submitted.signal_id}:%`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    });

    const { rows } = await fx.pool.query<{
      id: string;
      conversation_id: string;
      rep_id: string;
      counterparty_person_id: string;
      subject: string | null;
      body: string;
    }>(
      `select m.id, m.conversation_id, c.rep_id, c.counterparty_person_id,
              m.subject, m.body
         from messages m
         join conversations c on c.id = m.conversation_id
        where m.workspace_id = $1 and m.direction = 'outbound'
        order by m.created_at desc
        limit 1`,
      [submitted.workspace_id],
    );
    const message = rows[0];
    await fx.pool.query(
      `update messages set status = 'queued', external_id = null where id = $1`,
      [message.id],
    );
    const before = await fx.pool.query<{ daily_used: number }>(
      `select daily_used from channel_accounts where id = $1`,
      [boot.channel_account_id],
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
      [boot.channel_account_id],
    );
    assert.equal(after.rows[0].daily_used, before.rows[0].daily_used);

    await fx.pool.query(
      `update messages
          set properties = properties || jsonb_build_object(
            'send_reserved_at',
            (now() - interval '24 hours')::text
          )
        where id = $1`,
      [message.id],
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
    await fx.close();
  }
});
