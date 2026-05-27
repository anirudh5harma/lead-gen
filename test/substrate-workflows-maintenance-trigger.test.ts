import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { createMockEmbeddingClient } from "../core/ingest/embeddings.ts";
import { createExpireWorkflow } from "../core/ingest/expire.ts";
import { createCatalogPollWorkflow } from "../core/ingest/poll-workflow.ts";
import { createWorkspacePollWorkflow } from "../core/ingest/workspace-poll.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import {
  triggerDueWorkspaceMaintenance,
  type StartOptions,
  type WorkflowRun,
  type WorkflowRuntime,
} from "../core/substrate/workflows/index.ts";
import type { RunContext } from "../core/substrate/workflows/index.ts";
import { setupPg } from "./_pg.ts";

interface SeededMaintenance {
  workspace_id: string;
  source_id: string;
}

async function seedMaintenanceTargets(
  pool: Pool,
  opts: { archived?: boolean; sourcePolledAt?: Date | null } = {},
): Promise<SeededMaintenance> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name, archived_at)
     values ($1, $2, 'workspace', $3)`,
    [
      workspace_id,
      `ws-${workspace_id.slice(0, 8)}`,
      opts.archived ? new Date("2026-05-01T00:00:00Z") : null,
    ],
  );
  const source_id = randomUUID();
  await pool.query(
    `insert into graph_sources (id, workspace_id, kind, name, config)
     values ($1, $2, 'rss', 'feed', '{}'::jsonb)`,
    [source_id, workspace_id],
  );
  await pool.query(
    `insert into workspace_source_configs (
       workspace_id, source_id, poll_cadence_sec, last_polled_at
     ) values ($1, $2, 900, $3)`,
    [workspace_id, source_id, opts.sourcePolledAt ?? null],
  );
  const domainAccountId = randomUUID();
  await pool.query(
    `insert into channel_accounts (id, workspace_id, kind, display_name, status)
     values ($1, $2, 'email_domain', 'send.example.com', 'connected')`,
    [domainAccountId, workspace_id],
  );
  await pool.query(
    `insert into sending_domains (
       workspace_id, channel_account_id, domain, warmup_state
     ) values ($1, $2, $3, 'warming')`,
    [workspace_id, domainAccountId, `${workspace_id.slice(0, 8)}.example.com`],
  );
  await pool.query(
    `insert into channel_accounts (workspace_id, kind, display_name, status)
     values ($1, 'oauth_outlook', 'seller@example.com', 'connected')`,
    [workspace_id],
  );
  return { workspace_id, source_id };
}

function recordingRuntime(
  calls: Array<StartOptions<unknown>>,
  failWorkflow?: string,
): Pick<WorkflowRuntime, "start"> {
  return {
    async start<I, O = unknown>(
      opts: StartOptions<I>,
    ): Promise<WorkflowRun<I, O>> {
      calls.push(opts as StartOptions<unknown>);
      if (opts.workflow_name === failWorkflow) {
        throw new Error("Restate unavailable");
      }
      return {
        id: randomUUID(),
        execution_scope: opts.execution_scope ?? "workspace",
        workspace_id: opts.workspace_id,
        workflow_name: opts.workflow_name,
        workflow_version: "1",
        status: "running",
        input: opts.input,
        created_at: "2026-05-27T12:34:00.000Z",
      };
    },
  };
}

test("maintenance trigger starts due workspace Restate workflows with stable keys", async (t) => {
  const fx = await setupPg("maint_due");
  if (!fx) return t.skip("DATABASE_URL not set");
  const now = new Date("2026-05-27T12:34:00.000Z");
  const calls: Array<StartOptions<unknown>> = [];
  try {
    const due = await seedMaintenanceTargets(fx.pool);
    await seedMaintenanceTargets(fx.pool, { archived: true });
    await seedMaintenanceTargets(fx.pool, { sourcePolledAt: now });
    await fx.pool.query(
      `insert into platform_signal_sources (adapter, name, enabled)
       values ('greenhouse', 'Greenhouse', true), ('lever', 'Lever', false)`,
    );

    const summary = await triggerDueWorkspaceMaintenance({
      pool: fx.pool,
      runtime: recordingRuntime(calls),
      now: () => now,
    });

    assert.equal(summary.platform_catalog_polls_started, 1);
    assert.equal(summary.platform_expiry_sweeps_started, 1);
    assert.equal(summary.workspace_polls_started, 1);
    assert.equal(summary.warmup_sweeps_started, 2);
    assert.equal(summary.outlook_repairs_started, 2);
    assert.deepEqual(summary.failures, []);

    const platformCalls = calls.filter((call) => call.execution_scope === "platform");
    assert.equal(platformCalls.length, 2);
    assert.ok(platformCalls.every((call) => call.workspace_id === null));
    assert.ok(
      platformCalls.some(
        (call) =>
          call.workflow_name === "ingest_catalog_poll" &&
          call.idempotency_key?.startsWith("maintenance:catalog:greenhouse:"),
      ),
    );
    assert.ok(
      platformCalls.some(
        (call) =>
          call.workflow_name === "ingest_expire_sweep" &&
          call.idempotency_key === "maintenance:expire:2026-05-27",
      ),
    );

    const dueCalls = calls.filter((call) => call.workspace_id === due.workspace_id);
    assert.equal(dueCalls.length, 3);
    assert.deepEqual(
      dueCalls.map((call) => call.workflow_name).sort(),
      [
        "email_domain_warmup_sweep",
        "email_outlook_subscription_repair",
        "ingest_workspace_poll",
      ],
    );
    assert.ok(
      dueCalls.some(
        (call) =>
          call.workflow_name === "email_domain_warmup_sweep" &&
          call.idempotency_key === `maintenance:warmup:${due.workspace_id}:2026-05-27`,
      ),
    );
    assert.ok(
      dueCalls.some(
        (call) =>
          call.workflow_name === "email_outlook_subscription_repair" &&
          call.idempotency_key === `maintenance:outlook:${due.workspace_id}:2026-05-27T12`,
      ),
    );
  } finally {
    await fx.close();
  }
});

test("maintenance trigger reports one workflow start failure and continues others", async (t) => {
  const fx = await setupPg("maint_fail");
  if (!fx) return t.skip("DATABASE_URL not set");
  const calls: Array<StartOptions<unknown>> = [];
  try {
    await seedMaintenanceTargets(fx.pool);
    const summary = await triggerDueWorkspaceMaintenance({
      pool: fx.pool,
      runtime: recordingRuntime(calls, "email_domain_warmup_sweep"),
      now: () => new Date("2026-05-27T12:34:00.000Z"),
    });

    assert.equal(calls.length, 4);
    assert.equal(summary.platform_expiry_sweeps_started, 1);
    assert.equal(summary.workspace_polls_started, 1);
    assert.equal(summary.warmup_sweeps_started, 0);
    assert.equal(summary.outlook_repairs_started, 1);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].workflow_name, "email_domain_warmup_sweep");
  } finally {
    await fx.close();
  }
});

test("workspace poll workflow rejects a mismatched invocation tenant", async () => {
  const workflow = createWorkspacePollWorkflow({
    pool: null as unknown as Pool,
    bus: createInMemoryEventBus(),
    embedder: createMockEmbeddingClient(),
  });
  const ctx = { workspace_id: randomUUID() } as RunContext;

  await assert.rejects(
    workflow.run(
      { workspace_id: randomUUID(), source_id: randomUUID() },
      ctx,
    ),
    /input workspace does not match workflow workspace/,
  );
});

test("platform ingestion workflows reject workspace-scoped invocation", async () => {
  const bus = createInMemoryEventBus();
  const ctx = {
    execution_scope: "workspace",
    workspace_id: randomUUID(),
  } as RunContext;

  await assert.rejects(
    createCatalogPollWorkflow({
      pool: null as unknown as Pool,
      bus,
      embedder: createMockEmbeddingClient(),
    }).run({ adapter_id: "greenhouse" }, ctx),
    /platform-scoped invocation/,
  );
  await assert.rejects(
    createExpireWorkflow({
      pool: null as unknown as Pool,
      bus,
    }).run(undefined, ctx),
    /platform-scoped invocation/,
  );
});
