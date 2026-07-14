import type { Pool, PoolClient } from "pg";
import type { StartOptions, WorkflowRuntime } from "./types.ts";
import { mapWithConcurrency } from "../concurrency.ts";
import {
  listDueTrialWeekReminderWorkspaces as listDueTrialWeekReminderTargets,
} from "../../billing/trial-reminders.ts";

interface WorkspacePollTarget {
  workspace_id: string;
  source_id: string;
  poll_cadence_sec: number;
}

interface WorkspaceTarget {
  workspace_id: string;
}

interface PlatformCatalogTarget {
  adapter: string;
}

interface PlatformSharedTarget {
  adapter: string;
}

export interface WorkspaceMaintenanceTriggerDeps {
  pool: Pool;
  runtime: Pick<WorkflowRuntime, "start">;
  now?: () => Date;
  maxWorkspacePolls?: number;
  /** Caps each tenant maintenance category discovered per request. */
  maxTargetsPerCategory?: number;
  /** Bounds Restate ingress requests across all due maintenance targets. */
  startConcurrency?: number;
}

export interface WorkspaceMaintenanceStartFailure {
  workflow_name: string;
  execution_scope: "workspace" | "platform";
  workspace_id: string | null;
  error: string;
}

export interface WorkspaceMaintenanceTriggerSummary {
  triggered_at: string;
  platform_catalog_polls_started: number;
  platform_shared_polls_started: number;
  platform_expiry_sweeps_started: number;
  workspace_polls_started: number;
  warmup_sweeps_started: number;
  outlook_repairs_started: number;
  trial_week_reminder_sweeps_started: number;
  failures: WorkspaceMaintenanceStartFailure[];
}

/**
 * Finds due tenant-scoped maintenance and submits each unit to Restate.
 * State mutation remains inside the durable workflows; this function is
 * only the authenticated control-plane ingress.
 */
export async function triggerDueWorkspaceMaintenance(
  deps: WorkspaceMaintenanceTriggerDeps,
): Promise<WorkspaceMaintenanceTriggerSummary> {
  const now = deps.now?.() ?? new Date();
  const summary: WorkspaceMaintenanceTriggerSummary = {
    triggered_at: now.toISOString(),
    platform_catalog_polls_started: 0,
    platform_shared_polls_started: 0,
    platform_expiry_sweeps_started: 0,
    workspace_polls_started: 0,
    warmup_sweeps_started: 0,
    outlook_repairs_started: 0,
    trial_week_reminder_sweeps_started: 0,
    failures: [],
  };

  const maxWorkspacePolls = positiveLimit(deps.maxWorkspacePolls);
  const maxTargetsPerCategory =
    positiveLimit(deps.maxTargetsPerCategory) ?? 500;
  async function discover<T>(
    workflowName: string,
    executionScope: "platform" | "workspace",
    query: () => Promise<T[]>,
  ): Promise<T[]> {
    try {
      return await query();
    } catch (error) {
      summary.failures.push({
        workflow_name: workflowName,
        execution_scope: executionScope,
        workspace_id: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
  const [
    platformCatalog,
    platformShared,
    polls,
    warmups,
    outlookRepairs,
    trialWeekReminders,
  ] = await Promise.all([
    discover("ingest_catalog_poll.discovery", "platform", () =>
      listEnabledPlatformCatalogTargets(deps.pool)),
    discover("ingest_shared_x_poll.discovery", "platform", () =>
      listEnabledPlatformSharedTargets(deps.pool)),
    discover("ingest_workspace_poll.discovery", "workspace", () =>
      listDueWorkspacePolls(deps.pool, now, maxWorkspacePolls)),
    discover("email_domain_warmup_sweep.discovery", "workspace", () =>
      listWarmupWorkspaces(deps.pool, maxTargetsPerCategory)),
    discover("email_outlook_subscription_repair.discovery", "workspace", () =>
      listOutlookRepairWorkspaces(deps.pool, now, maxTargetsPerCategory)),
    discover("billing_trial_week_reminder.discovery", "workspace", () =>
      listTrialReminderWorkspaces(
        deps.pool,
        now,
        maxTargetsPerCategory,
      )),
  ]);

  const sixHourBucket = Math.floor(now.getTime() / (6 * 60 * 60 * 1000));
  const dayBucket = now.toISOString().slice(0, 10);
  const hourBucket = now.toISOString().slice(0, 13);
  const starts: Array<() => Promise<void>> = [];
  for (const target of platformCatalog) {
    starts.push(async () => {
      const started = await startWorkflow(deps.runtime, summary, {
        execution_scope: "platform",
        workspace_id: null,
        workflow_name: "ingest_catalog_poll",
        idempotency_key: `maintenance:catalog:${target.adapter}:${sixHourBucket}`,
        input: { adapter_id: target.adapter },
      });
      if (started) summary.platform_catalog_polls_started += 1;
    });
  }

  for (const target of platformShared) {
    starts.push(async () => {
      const started = await startWorkflow(deps.runtime, summary, {
        execution_scope: "platform",
        workspace_id: null,
        workflow_name: "ingest_shared_x_poll",
        idempotency_key: `maintenance:shared:${target.adapter}:${sixHourBucket}`,
        input: { adapter_id: target.adapter },
      });
      if (started) summary.platform_shared_polls_started += 1;
    });
  }

  starts.push(async () => {
    const started = await startWorkflow(deps.runtime, summary, {
      execution_scope: "platform",
      workspace_id: null,
      workflow_name: "ingest_expire_sweep",
      idempotency_key: `maintenance:expire:${dayBucket}`,
      input: {},
    });
    if (started) summary.platform_expiry_sweeps_started += 1;
  });

  for (const target of polls) {
    const cadenceBucket = Math.floor(
      now.getTime() / (target.poll_cadence_sec * 1000),
    );
    starts.push(async () => {
      const started = await startWorkflow(deps.runtime, summary, {
        workspace_id: target.workspace_id,
        workflow_name: "ingest_workspace_poll",
        idempotency_key:
          `maintenance:workspace-poll:${target.workspace_id}:${target.source_id}:${cadenceBucket}`,
        input: {
          workspace_id: target.workspace_id,
          source_id: target.source_id,
        },
      });
      if (started) summary.workspace_polls_started += 1;
    });
  }

  for (const target of warmups) {
    starts.push(async () => {
      const started = await startWorkflow(deps.runtime, summary, {
        workspace_id: target.workspace_id,
        workflow_name: "email_domain_warmup_sweep",
        idempotency_key: `maintenance:warmup:${target.workspace_id}:${dayBucket}`,
        input: { workspace_id: target.workspace_id },
      });
      if (started) summary.warmup_sweeps_started += 1;
    });
  }

  for (const target of outlookRepairs) {
    starts.push(async () => {
      const started = await startWorkflow(deps.runtime, summary, {
        workspace_id: target.workspace_id,
        workflow_name: "email_outlook_subscription_repair",
        idempotency_key: `maintenance:outlook:${target.workspace_id}:${hourBucket}`,
        input: { workspace_id: target.workspace_id },
      });
      if (started) summary.outlook_repairs_started += 1;
    });
  }

  for (const target of trialWeekReminders) {
    starts.push(async () => {
      const started = await startWorkflow(deps.runtime, summary, {
        workspace_id: target.workspace_id,
        workflow_name: "billing_trial_week_reminder",
        idempotency_key:
          `maintenance:trial-week:${target.workspace_id}:${dayBucket}`,
        input: { workspace_id: target.workspace_id },
      });
      if (started) summary.trial_week_reminder_sweeps_started += 1;
    });
  }

  await mapWithConcurrency(
    starts,
    positiveConcurrency(deps.startConcurrency),
    (start) => start(),
  );

  return summary;
}

function positiveConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(50, Math.trunc(value)));
}

function positiveLimit(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const limit = Math.trunc(value);
  return limit > 0 ? limit : null;
}

async function startWorkflow(
  runtime: Pick<WorkflowRuntime, "start">,
  summary: WorkspaceMaintenanceTriggerSummary,
  opts: StartOptions<unknown>,
): Promise<boolean> {
  try {
    await runtime.start(opts);
    return true;
  } catch (err) {
    summary.failures.push({
      workflow_name: opts.workflow_name,
      execution_scope: opts.execution_scope ?? "workspace",
      workspace_id: opts.workspace_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function listEnabledPlatformCatalogTargets(
  pool: Pool,
): Promise<PlatformCatalogTarget[]> {
  const { rows } = await pool.query<PlatformCatalogTarget>(
    `select adapter
       from platform_signal_sources
      where enabled
        and adapter <> 'x_search_shared'
      order by adapter`,
  );
  return rows;
}

async function listEnabledPlatformSharedTargets(
  pool: Pool,
): Promise<PlatformSharedTarget[]> {
  const { rows } = await pool.query<PlatformSharedTarget>(
    `select adapter
       from platform_signal_sources
      where enabled
        and adapter = 'x_search_shared'
      order by adapter`,
  );
  return rows;
}

async function listDueWorkspacePolls(
  pool: Pool,
  now: Date,
  limit: number | null,
): Promise<WorkspacePollTarget[]> {
  // Oldest last_polled_at first — starves no workspace when limit binds.
  // Nulls (never polled) win; ties broken deterministically.
  const { rows } = await pool.query<WorkspacePollTarget>(
    `select wsc.workspace_id, wsc.source_id, wsc.poll_cadence_sec
       from workspace_source_configs wsc
       join workspaces w on w.id = wsc.workspace_id
       join graph_sources gs
         on gs.workspace_id = wsc.workspace_id and gs.id = wsc.source_id
      where w.archived_at is null
        and wsc.enabled
        and gs.enabled
        and (
          wsc.last_polled_at is null
          or wsc.last_polled_at <= $1::timestamptz - (wsc.poll_cadence_sec * interval '1 second')
        )
      order by wsc.last_polled_at asc nulls first,
               wsc.workspace_id, wsc.source_id
      limit $2`,
    [now, limit ?? 1000],
  );
  return rows;
}

async function listWarmupWorkspaces(
  pool: Pool,
  limit: number,
): Promise<WorkspaceTarget[]> {
  return listTargetsWithCursor(
    pool,
    "email_domain_warmup",
    limit,
    (client, cursor, boundedLimit) => client.query<WorkspaceTarget>(
      `select workspace_id
         from (
           select distinct sd.workspace_id
             from sending_domains sd
             join workspaces w on w.id = sd.workspace_id
            where w.archived_at is null
              and sd.warmup_state in ('unverified', 'verifying', 'warming', 'warmed', 'degraded')
         ) candidates
        order by (workspace_id > coalesce($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)) desc,
                 workspace_id
        limit $2`,
      [cursor, boundedLimit],
    ),
  );
}

async function listOutlookRepairWorkspaces(
  pool: Pool,
  now: Date,
  limit: number,
): Promise<WorkspaceTarget[]> {
  // Three repair triggers: (1) no subscription yet, (2) within 12h of
  // expiry, (3) legacy subscription without a lifecycleNotificationUrl —
  // the repair workflow recreates these so they enroll in lifecycle
  // events going forward.
  return listTargetsWithCursor(
    pool,
    "outlook_subscription_repair",
    limit,
    (client, cursor, boundedLimit) => client.query<WorkspaceTarget>(
      `select workspace_id
         from (
           select distinct ca.workspace_id
             from channel_accounts ca
             join workspaces w on w.id = ca.workspace_id
            where w.archived_at is null
              and ca.kind = 'oauth_outlook'
              and ca.status = 'connected'
              and (
                ca.properties -> 'outlook_subscription' is null
                or (ca.properties -> 'outlook_subscription' ->> 'expirationDateTime')::timestamptz
                     <= $1::timestamptz + interval '12 hours'
                or ca.properties -> 'outlook_subscription' ->> 'lifecycleNotificationUrl' is null
              )
         ) candidates
        order by (workspace_id > coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)) desc,
                 workspace_id
        limit $3`,
      [now, cursor, boundedLimit],
    ),
  );
}

async function listTrialReminderWorkspaces(
  pool: Pool,
  now: Date,
  limit: number,
): Promise<WorkspaceTarget[]> {
  return listTargetsWithCursor(
    pool,
    "billing_trial_week_reminder",
    limit,
    async (client, cursor, boundedLimit) => ({
      rows: await listDueTrialWeekReminderTargets(
        client,
        now,
        boundedLimit,
        cursor,
      ),
    }),
  );
}

async function listTargetsWithCursor(
  pool: Pool,
  category: string,
  limit: number,
  query: (
    client: PoolClient,
    cursor: string | null,
    limit: number,
  ) => Promise<{ rows: WorkspaceTarget[] }>,
): Promise<WorkspaceTarget[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into maintenance_fanout_cursors (category)
       values ($1)
       on conflict (category) do nothing`,
      [category],
    );
    const cursorResult = await client.query<{ last_workspace_id: string | null }>(
      `select last_workspace_id
         from maintenance_fanout_cursors
        where category = $1
        for update`,
      [category],
    );
    const { rows } = await query(
      client,
      cursorResult.rows[0]?.last_workspace_id ?? null,
      limit,
    );
    const lastWorkspaceId = rows.at(-1)?.workspace_id;
    if (lastWorkspaceId) {
      await client.query(
        `update maintenance_fanout_cursors
            set last_workspace_id = $2,
                updated_at = now()
          where category = $1`,
        [category, lastWorkspaceId],
      );
    }
    await client.query("commit");
    return rows;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
