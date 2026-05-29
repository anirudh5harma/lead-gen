import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../substrate/workflows/index.ts";
import { SignalKind } from "../primitives/signal.ts";
import type { EmbeddingClient } from "./embeddings.ts";
import {
  ensureBudgetRow,
  recordOverflow,
  reserveCandidate,
} from "./budget.ts";
import {
  allMatchingIcps,
} from "./icp-filter.ts";
import { listIcps } from "./icps.ts";
import type {
  WorkspaceAdapter,
} from "./adapters/_workspace-types.ts";
import { getWorkspaceAdapter } from "./adapters/registry.ts";

/**
 * Workspace-poll workflow. Per-(workspace, source) durable pollers that
 * bypass the shared signal_candidates pool: their items are workspace-
 * specific by definition (custom RSS, Google News keyword, Reddit sub,
 * HN front, HN Who-is-hiring, ProductHunt). They emit typed discovered
 * Signal events; the signal projector owns `signals` materialization.
 *
 * Dedup is per-workspace: check (workspace_id, source_id,
 * properties->>'external_id') before insert. Budget cap still applies.
 * ICP must_haves still pre-filter — same shape as catalog fanout —
 * before insertion.
 */

export const WORKSPACE_POLL_WORKFLOW = "ingest_workspace_poll";

export interface WorkspacePollDeps {
  pool: Pool;
  bus: EventBus;
  embedder: EmbeddingClient;
  fetchImpl?: typeof fetch;
}

export interface WorkspacePollInput {
  workspace_id: string;
  source_id: string;
}

export interface WorkspacePollSummary {
  workspace_id: string;
  source_id: string;
  inserted: number;
  duplicates: number;
  skipped_must_haves: number;
  skipped_budget: number;
  error?: string;
}

interface SourceRow {
  id: string;
  workspace_id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
}

interface ConfigRow {
  cursor: Record<string, unknown>;
}

async function loadSource(
  pool: Pool,
  workspace_id: string,
  source_id: string,
): Promise<SourceRow | null> {
  const { rows } = await pool.query<SourceRow>(
    `select id, workspace_id, kind::text as kind, name, config
       from graph_sources
      where workspace_id = $1 and id = $2 and enabled`,
    [workspace_id, source_id],
  );
  return rows[0] ?? null;
}

async function loadWsCursor(
  pool: Pool,
  workspace_id: string,
  source_id: string,
): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<ConfigRow>(
    `select cursor from workspace_source_configs
      where workspace_id = $1 and source_id = $2`,
    [workspace_id, source_id],
  );
  return rows[0]?.cursor ?? {};
}

async function saveWsCursor(
  pool: Pool,
  workspace_id: string,
  source_id: string,
  cursor: Record<string, unknown>,
  error: unknown = null,
): Promise<void> {
  const errPayload =
    error instanceof Error ? { message: error.message } : error == null ? null : error;
  await pool.query(
    `insert into workspace_source_configs (
       workspace_id, source_id, cursor, last_polled_at, last_error
     ) values ($1, $2, $3::jsonb, now(), $4::jsonb)
     on conflict (workspace_id, source_id) do update set
       cursor         = excluded.cursor,
       last_polled_at = excluded.last_polled_at,
       last_error     = excluded.last_error`,
    [workspace_id, source_id, JSON.stringify(cursor), JSON.stringify(errPayload)],
  );
  await pool.query(
    `update graph_sources
        set last_polled_at = now()
      where workspace_id = $1 and id = $2`,
    [workspace_id, source_id],
  );
}

async function alreadyExists(
  pool: Pool,
  workspace_id: string,
  source_id: string,
  external_id: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from signals
      where workspace_id = $1
        and source_id    = $2
        and provenance->>'external_id' = $3
      limit 1`,
    [workspace_id, source_id, external_id],
  );
  return rows.length > 0;
}

/**
 * One poll cycle for one (workspace, source). Called by the workspace-poll
 * workflow + by tests.
 */
export async function workspacePollOnce(
  deps: WorkspacePollDeps,
  input: WorkspacePollInput,
): Promise<WorkspacePollSummary> {
  const summary: WorkspacePollSummary = {
    workspace_id: input.workspace_id,
    source_id: input.source_id,
    inserted: 0,
    duplicates: 0,
    skipped_must_haves: 0,
    skipped_budget: 0,
  };
  const source = await loadSource(deps.pool, input.workspace_id, input.source_id);
  if (!source) {
    summary.error = "source not found";
    return summary;
  }
  const adapterId =
    typeof source.config.adapter === "string" && source.config.adapter.trim()
      ? source.config.adapter.trim()
      : source.kind;
  const adapter = getWorkspaceAdapter(adapterId);
  if (!adapter) {
    summary.error = `no workspace adapter for '${adapterId}'`;
    return summary;
  }
  const configuredKind = parseConfiguredSignalKind(source.config);
  const cursor = await loadWsCursor(deps.pool, input.workspace_id, input.source_id);

  let pollResult: Awaited<ReturnType<WorkspaceAdapter["poll"]>>;
  try {
    pollResult = await adapter.poll({
      workspace_id: input.workspace_id,
      source: { id: source.id, name: source.name, config: source.config },
      cursor,
      fetchImpl: deps.fetchImpl,
    });
  } catch (err) {
    await saveWsCursor(deps.pool, input.workspace_id, input.source_id, cursor, err);
    summary.error = err instanceof Error ? err.message : String(err);
    return summary;
  }

  await ensureBudgetRow(deps.pool, input.workspace_id);
  const icps = await listIcps(deps.pool, input.workspace_id, { only_enabled: true });

  for (const item of pollResult.items) {
    if (await alreadyExists(deps.pool, input.workspace_id, input.source_id, item.external_id)) {
      summary.duplicates += 1;
      continue;
    }

    const itemKind = item.kind ?? adapter.kindHint ?? configuredKind;
    const filterCtx = {
      candidate: {
        kind: itemKind,
        title: item.title,
        url: item.url,
        structured: item.structured ?? {},
        freshness_at: item.freshness_at,
      },
    };
    if (icps.length > 0 && allMatchingIcps(icps, filterCtx).length === 0) {
      summary.skipped_must_haves += 1;
      continue;
    }

    const reserved = await reserveCandidate(deps.pool, input.workspace_id);
    if (!reserved) {
      await recordOverflow(
        deps.pool,
        input.workspace_id,
        input.source_id,
        "daily_cap_reached",
        { external_id: item.external_id, title: item.title },
      );
      summary.skipped_budget += 1;
      continue;
    }

    const leadText = `${item.title} ${(item.content ?? "").slice(0, 200)}`.trim();
    const [embedding] = await deps.embedder.embed([leadText]);

    const signal_id = randomUUID();
    await deps.bus.publish({
      workspace_id: input.workspace_id,
      event_type: "signal.discovered",
      source: "system",
      producer_ref: `ingest:workspace:${adapter.id}`,
      idempotency_key:
        `workspace-source:${input.source_id}:external:${item.external_id}`,
      payload: {
        signal_id,
        source_id: input.source_id,
        kind: itemKind ?? null,
        title: item.title,
        content: item.content ?? null,
        url: item.url ?? null,
        freshness_at: item.freshness_at,
        related_company_id: null,
        related_person_id: null,
        origin_candidate_id: null,
        properties: { structured: item.structured ?? {} },
        provenance: {
          adapter: adapter.id,
          external_id: item.external_id,
          ...(item.provenance ?? {}),
        },
        embedding,
      },
    });
    summary.inserted += 1;
  }

  await saveWsCursor(deps.pool, input.workspace_id, input.source_id, pollResult.cursor, null);
  return summary;
}

function parseConfiguredSignalKind(config: Record<string, unknown>) {
  const parsed = SignalKind.safeParse(config.kind ?? config.signal_kind);
  return parsed.success ? parsed.data : null;
}

/**
 * Durable workflow wrapping workspacePollOnce so per-(workspace, source)
 * polls are journaled + retryable. Mirrors createCatalogPollWorkflow.
 */
export function createWorkspacePollWorkflow(
  deps: WorkspacePollDeps,
): WorkflowDefinition<WorkspacePollInput, WorkspacePollSummary> {
  return defineWorkflow<WorkspacePollInput, WorkspacePollSummary>({
    name: WORKSPACE_POLL_WORKFLOW,
    version: "1",
    async run(input, ctx): Promise<WorkspacePollSummary> {
      if (input.workspace_id !== ctx.workspace_id) {
        throw new Error(
          "workspace poll input workspace does not match workflow workspace",
        );
      }
      return ctx.step(
        "poll_once",
        () => workspacePollOnce(deps, input),
        {
          retry: { max_attempts: 2, backoff: "exponential", base_ms: 200 },
        },
      );
    },
  });
}
