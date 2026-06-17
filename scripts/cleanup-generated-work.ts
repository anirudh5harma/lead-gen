#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import {
  deleteProductRecommendation,
  getProductRecommendationSurface,
  resetProductEngineForTests,
  type ProductRecommendationKind,
} from "../core/product/app.ts";

const TARGET_EVENT_TYPES = [
  "signal.discovered",
  "signal.ingested",
  "signal.matched",
  "signal.dismissed",
  "signal.classification.completed",
  "signal.expired",
  "signal.expiry.requested",
  "content.opportunity.discovered",
  "aeo.audit.completed",
  "rep.brief.refreshed",
  "recommendation.reviewed",
  "recommendation.updated",
  "recommendation.deleted",
] as const;

const TARGET_WORKFLOWS = [
  "ingest_catalog_poll",
  "ingest_workspace_poll",
  "ingest_expire_sweep",
  "content.opportunity.exa",
  "aeo.audit.exa",
  "rep.brief.refresh.exa",
] as const;

interface CleanupCounts {
  signals: string;
  signal_fanouts: string;
  signal_overflow: string;
  append_only_events_kept: string;
  target_projection_jobs: string;
  recommendation_outcomes: string;
  recommendation_outcome_events: string;
  target_workflows: string;
  maya_reps: string;
}

loadDotenvLocal();

const apply = process.argv.includes("--apply");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const before = await counts();
  printCounts(apply ? "Before cleanup" : "Dry run", before);
  if (!apply) {
    console.log("\nNo changes applied. Re-run with --apply to clean generated work.");
    process.exit(0);
  }

  await hideExistingRecommendations();

  await pool.query("begin");
  try {
    await mergeOrRetireMaya();
    await clearGeneratedWork();
    await pool.query("commit");
  } catch (err) {
    await pool.query("rollback");
    throw err;
  }

  const after = await counts();
  printCounts("After cleanup", after);
} finally {
  await resetProductEngineForTests();
  await pool.end();
}

async function counts(): Promise<CleanupCounts> {
  const { rows } = await pool.query<CleanupCounts>(
    `select
       (select count(*)::text from signals) as signals,
       (select count(*)::text from signal_candidate_fanouts) as signal_fanouts,
       (select count(*)::text from signal_overflow) as signal_overflow,
       (select count(*)::text from events where event_type = any($1::text[])) as append_only_events_kept,
       (select count(*)::text
          from event_projection_jobs epj
          join events e on e.id = epj.event_id
         where e.event_type = any($1::text[])) as target_projection_jobs,
       (select count(*)::text
          from outcomes
         where properties ? 'recommendation_review_id') as recommendation_outcomes,
       (select count(*)::text
         from events
         where event_type = 'outcome.recorded'
           and (payload->'properties') ? 'recommendation_review_id') as recommendation_outcome_events,
       (select count(*)::text
          from workflow_runs
         where workflow_name = any($2::text[])) as target_workflows,
       (select count(*)::text
          from reps
         where lower(name) = 'maya') as maya_reps`,
    [[...TARGET_EVENT_TYPES], [...TARGET_WORKFLOWS]],
  );
  return rows[0]!;
}

async function mergeOrRetireMaya(): Promise<void> {
  await pool.query(
    `update conversations c
        set rep_id = sampark.id
       from reps maya
       join reps sampark
         on sampark.workspace_id = maya.workspace_id
        and lower(sampark.name) = 'sampark'
      where c.rep_id = maya.id
        and lower(maya.name) = 'maya'`,
  );
  await pool.query(
    `update plays p
        set default_rep_id = sampark.id
       from reps maya
       join reps sampark
         on sampark.workspace_id = maya.workspace_id
        and lower(sampark.name) = 'sampark'
      where p.default_rep_id = maya.id
        and lower(maya.name) = 'maya'`,
  );
  await pool.query(
    `update play_runs pr
        set rep_id = sampark.id
       from reps maya
       join reps sampark
         on sampark.workspace_id = maya.workspace_id
        and lower(sampark.name) = 'sampark'
      where pr.rep_id = maya.id
        and lower(maya.name) = 'maya'`,
  );
  await pool.query(
    `update outcomes o
        set attributed_rep_id = sampark.id
       from reps maya
       join reps sampark
         on sampark.workspace_id = maya.workspace_id
        and lower(sampark.name) = 'sampark'
      where o.attributed_rep_id = maya.id
        and lower(maya.name) = 'maya'`,
  );
  await pool.query(
    `delete from rep_memory_episodic
      where rep_id in (select id from reps where lower(name) = 'maya')`,
  );
  await pool.query(
    `delete from rep_memory_semantic
      where rep_id in (select id from reps where lower(name) = 'maya')`,
  );
  await pool.query(
    `delete from rep_memory_procedural
      where rep_id in (select id from reps where lower(name) = 'maya')`,
  );
  await pool.query(
    `update reps maya
        set name = 'Outbound agent',
            status = 'active',
            updated_at = now()
      where lower(maya.name) = 'maya'
        and not exists (
          select 1
            from reps outbound
           where outbound.workspace_id = maya.workspace_id
             and lower(outbound.name) = 'outbound agent'
        )`,
  );
  await pool.query(
    `update reps
        set name = 'Retired rep ' || left(id::text, 8),
            status = 'retired',
            updated_at = now()
      where lower(name) = 'maya'`,
  );
  await pool.query(
    `update channel_accounts
        set display_name = regexp_replace(display_name, 'maya', 'sampark', 'ig'),
            updated_at = now()
      where display_name ~* 'maya'`,
  );
}

async function hideExistingRecommendations(): Promise<void> {
  const { rows } = await pool.query<{ workspace_id: string; user_id: string }>(
    `select distinct on (w.id)
            w.id::text as workspace_id,
            wm.user_id::text as user_id
       from workspaces w
       join workspace_members wm
         on wm.workspace_id = w.id
        and wm.accepted_at is not null
      order by w.id, wm.accepted_at asc nulls last, wm.user_id`,
  );
  for (const row of rows) {
    const session = { workspace_id: row.workspace_id, user_id: row.user_id };
    for (const surface of ["content_opportunity", "aeo_gap"] satisfies ProductRecommendationKind[]) {
      const state = await getProductRecommendationSurface(pool, session, surface);
      for (const item of state.reviews) {
        if (!item.review_id || item.outcome_id) continue;
        await deleteProductRecommendation(
          {
            review_id: item.review_id,
            reason: "Generated pre-launch suggestion cleanup",
          },
          session,
        );
      }
    }
  }
}

async function clearGeneratedWork(): Promise<void> {
  await pool.query(
    `update conversations
        set origin_signal_id = null
      where origin_signal_id is not null`,
  );
  await pool.query(
    `update outcomes
        set attributed_signal_id = null
      where attributed_signal_id is not null`,
  );
  await pool.query("update signal_candidate_fanouts set signal_id = null");
  await pool.query("delete from signals");
  await pool.query("delete from signal_candidate_fanouts");
  await pool.query("delete from signal_overflow");
  await pool.query(
    `do $$
     begin
       if to_regclass('public.procedural_memory_applications') is not null then
         delete from procedural_memory_applications
          where outcome_event_id in (
            select id
              from events
             where event_type = 'outcome.recorded'
               and (payload->'properties') ? 'recommendation_review_id'
          );
       end if;
     end $$`,
  );
  await pool.query(
    `delete from event_projection_jobs
      where event_id in (
        select id
         from events
         where event_type = 'outcome.recorded'
           and (payload->'properties') ? 'recommendation_review_id'
      )`,
  );
  await pool.query(
    `delete from outcomes
      where properties ? 'recommendation_review_id'`,
  );
  await pool.query(
    `delete from event_projection_jobs
      where event_id in (
        select id from events where event_type = any($1::text[])
      )`,
    [[...TARGET_EVENT_TYPES]],
  );
  await pool.query(
    `delete from workflow_runs
      where workflow_name = any($1::text[])`,
    [[...TARGET_WORKFLOWS]],
  );
}

function printCounts(label: string, row: CleanupCounts): void {
  console.log(`\n${label}`);
  for (const [key, value] of Object.entries(row)) {
    console.log(`  ${key}: ${value}`);
  }
}

function loadDotenvLocal(): void {
  if (process.env.DATABASE_URL || !existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key!]) continue;
    process.env[key!] = raw!.trim().replace(/^['"]|['"]$/g, "");
  }
}
