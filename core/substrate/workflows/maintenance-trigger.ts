import type { Pool } from "pg";
import type { StartOptions, WorkflowRuntime } from "./types.ts";

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
    failures: [],
  };

  const [platformCatalog, platformShared, polls, warmups, outlookRepairs] = await Promise.all([
    listEnabledPlatformCatalogTargets(deps.pool),
    listEnabledPlatformSharedTargets(deps.pool),
    listDueWorkspacePolls(deps.pool, now),
    listWarmupWorkspaces(deps.pool),
    listOutlookRepairWorkspaces(deps.pool, now),
  ]);

  const sixHourBucket = Math.floor(now.getTime() / (6 * 60 * 60 * 1000));
  for (const target of platformCatalog) {
    const started = await startWorkflow(deps.runtime, summary, {
      execution_scope: "platform",
      workspace_id: null,
      workflow_name: "ingest_catalog_poll",
      idempotency_key: `maintenance:catalog:${target.adapter}:${sixHourBucket}`,
      input: { adapter_id: target.adapter },
    });
    if (started) summary.platform_catalog_polls_started += 1;
  }

  for (const target of platformShared) {
    const started = await startWorkflow(deps.runtime, summary, {
      execution_scope: "platform",
      workspace_id: null,
      workflow_name: "ingest_shared_x_poll",
      idempotency_key: `maintenance:shared:${target.adapter}:${sixHourBucket}`,
      input: { adapter_id: target.adapter },
    });
    if (started) summary.platform_shared_polls_started += 1;
  }

  const dayBucket = now.toISOString().slice(0, 10);
  const expiryStarted = await startWorkflow(deps.runtime, summary, {
    execution_scope: "platform",
    workspace_id: null,
    workflow_name: "ingest_expire_sweep",
    idempotency_key: `maintenance:expire:${dayBucket}`,
    input: {},
  });
  if (expiryStarted) summary.platform_expiry_sweeps_started += 1;

  for (const target of polls) {
    const cadenceBucket = Math.floor(
      now.getTime() / (target.poll_cadence_sec * 1000),
    );
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
  }

  for (const target of warmups) {
    const started = await startWorkflow(deps.runtime, summary, {
      workspace_id: target.workspace_id,
      workflow_name: "email_domain_warmup_sweep",
      idempotency_key: `maintenance:warmup:${target.workspace_id}:${dayBucket}`,
      input: { workspace_id: target.workspace_id },
    });
    if (started) summary.warmup_sweeps_started += 1;
  }

  const hourBucket = now.toISOString().slice(0, 13);
  for (const target of outlookRepairs) {
    const started = await startWorkflow(deps.runtime, summary, {
      workspace_id: target.workspace_id,
      workflow_name: "email_outlook_subscription_repair",
      idempotency_key: `maintenance:outlook:${target.workspace_id}:${hourBucket}`,
      input: { workspace_id: target.workspace_id },
    });
    if (started) summary.outlook_repairs_started += 1;
  }

  return summary;
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
): Promise<WorkspacePollTarget[]> {
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
      order by wsc.workspace_id, wsc.source_id`,
    [now],
  );
  return rows;
}

async function listWarmupWorkspaces(pool: Pool): Promise<WorkspaceTarget[]> {
  const { rows } = await pool.query<WorkspaceTarget>(
    `select distinct sd.workspace_id
       from sending_domains sd
       join workspaces w on w.id = sd.workspace_id
      where w.archived_at is null
        and sd.warmup_state in ('unverified', 'verifying', 'warming', 'warmed', 'degraded')
      order by sd.workspace_id`,
  );
  return rows;
}

async function listOutlookRepairWorkspaces(
  pool: Pool,
  now: Date,
): Promise<WorkspaceTarget[]> {
  // Three repair triggers: (1) no subscription yet, (2) within 12h of
  // expiry, (3) legacy subscription without a lifecycleNotificationUrl —
  // the repair workflow recreates these so they enroll in lifecycle
  // events going forward.
  const { rows } = await pool.query<WorkspaceTarget>(
    `select distinct ca.workspace_id
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
      order by ca.workspace_id`,
    [now],
  );
  return rows;
}
