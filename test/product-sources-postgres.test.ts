import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupPg } from "./_pg.ts";
import {
  configureRssSource,
  findFirstProductWorkspaceForUser,
  getAppState,
  resetProductEngineForTests,
} from "../core/product/app.ts";
import { RSS_SIGNAL_INGESTION_WORKFLOW } from "../core/signals/index.ts";
import { resetPool, setPool } from "../core/substrate/storage/index.ts";

test("product surface: configured RSS sources appear in app state with operator metadata", async (t) => {
  const fx = await setupPg("product_sources");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    await configureRssSource({
      name: "Launch Feed",
      url: "https://example.com/feed.xml",
      signal_kind: "product_launch",
      poll_interval_minutes: 7,
    });

    const state = await getAppState(fx.pool);
    const source = state.sources.find((row) => row.name === "Launch Feed");
    assert.ok(source);
    assert.equal(source.url, "https://example.com/feed.xml");
    assert.equal(source.signal_kind, "product_launch");
    assert.equal(source.poll_interval_minutes, 7);
    assert.equal(source.signal_count, 0);
    assert.equal(source.latest_run_status, null);
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product surface: failed workflows appear in the recovery queue", async (t) => {
  const fx = await setupPg("product_recovery");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await configureRssSource({
      name: "Broken Feed",
      url: "https://example.com/broken.xml",
      signal_kind: "press_mention",
      poll_interval_minutes: 15,
    });
    const source = await fx.pool.query<{ id: string }>(
      `select id from graph_sources where workspace_id = $1 and name = $2`,
      [boot.workspace_id, "Broken Feed"],
    );
    const runId = randomUUID();
    const stepId = randomUUID();
    await fx.pool.query(
      `insert into workflow_runs (
         id, workspace_id, workflow_name, workflow_version, status, input,
         error, started_at, ended_at, created_at
       ) values ($1, $2, $3, '1', 'failed', $4::jsonb, $5::jsonb, now(), now(), now())`,
      [
        runId,
        boot.workspace_id,
        RSS_SIGNAL_INGESTION_WORKFLOW,
        JSON.stringify({
          workspace_id: boot.workspace_id,
          source_id: source.rows[0].id,
        }),
        JSON.stringify({ message: "RSS fetch failed" }),
      ],
    );
    await fx.pool.query(
      `insert into workflow_steps (
         id, run_id, workspace_id, step_name, step_position, attempt,
         status, error, started_at, ended_at, created_at
       ) values ($1, $2, $3, 'rss.fetch', 1, 3, 'failed', $4::jsonb, now(), now(), now())`,
      [stepId, runId, boot.workspace_id, JSON.stringify({ message: "RSS fetch failed" })],
    );

    const state = await getAppState(fx.pool);
    const recovery = state.recoveryQueue.find((row) => row.id === runId);
    assert.ok(recovery);
    assert.equal(recovery.workflow_name, RSS_SIGNAL_INGESTION_WORKFLOW);
    assert.equal(recovery.error, "RSS fetch failed");
    assert.equal(recovery.failed_step_name, "rss.fetch");
    assert.equal(recovery.failed_step_attempt, 3);
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product surface: app state requires workspace membership", async (t) => {
  const fx = await setupPg("product_membership");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const boot = await configureRssSource({
      name: "Member Feed",
      url: "https://example.com/feed.xml",
      signal_kind: "press_mention",
      poll_interval_minutes: 15,
    });

    await assert.rejects(
      () =>
        getAppState(fx.pool, {
          workspace_id: boot.workspace_id,
          user_id: "00000000-0000-4000-8000-00000000beef",
        }),
      /not a member/,
    );
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product surface: resolves first accepted workspace membership", async (t) => {
  const fx = await setupPg("product_first_workspace");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const user_id = "00000000-0000-4000-8000-00000000cafe";
    const acceptedWorkspaceId = randomUUID();
    const pendingWorkspaceId = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name, settings)
       values ($1, 'pending-member', 'Pending Member', '{}'::jsonb),
              ($2, 'accepted-member', 'Accepted Member', '{}'::jsonb)`,
      [pendingWorkspaceId, acceptedWorkspaceId],
    );
    await fx.pool.query(
      `insert into workspace_members (workspace_id, user_id, role, accepted_at)
       values ($1, $3, 'member', null),
              ($2, $3, 'member', now())`,
      [pendingWorkspaceId, acceptedWorkspaceId, user_id],
    );

    assert.equal(
      await findFirstProductWorkspaceForUser(user_id, fx.pool),
      acceptedWorkspaceId,
    );
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});
