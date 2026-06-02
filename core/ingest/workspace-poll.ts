import type { Pool } from "pg";
import { createHash } from "node:crypto";
import type { EventBus } from "../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../substrate/workflows/index.ts";
import type { EmbeddingClient } from "./embeddings.ts";
import {
  discoverWorkspaceSignal,
  loadWorkspaceSignalSource,
  prepareWorkspaceSignalDiscoveryContext,
  type WorkspaceSignalDiscoveryContext,
  type WorkspaceSignalDiscoveryItem,
} from "./workspace-discovery.ts";
import type { WorkspaceAdapter } from "./adapters/_workspace-types.ts";
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
const DEFAULT_MAX_ITEMS_PER_POLL = 3;
const HARD_MAX_ITEMS_PER_POLL = 10;
const MAX_PREPARED_CONTENT_CHARS = 600;

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

interface ConfigRow {
  cursor: Record<string, unknown>;
}

interface WorkspacePollPreparation {
  summary: WorkspacePollSummary;
  discovery: WorkspaceSignalDiscoveryContext | null;
  items: WorkspaceSignalDiscoveryItem[];
  cursor: Record<string, unknown>;
  save_cursor: boolean;
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

/**
 * One poll cycle for one (workspace, source). Called by the workspace-poll
 * workflow + by tests.
 */
export async function workspacePollOnce(
  deps: WorkspacePollDeps,
  input: WorkspacePollInput,
): Promise<WorkspacePollSummary> {
  const prepared = await prepareWorkspacePoll(deps, input);
  return processPreparedWorkspacePoll(deps, prepared);
}

async function prepareWorkspacePoll(
  deps: WorkspacePollDeps,
  input: WorkspacePollInput,
): Promise<WorkspacePollPreparation> {
  const summary: WorkspacePollSummary = {
    workspace_id: input.workspace_id,
    source_id: input.source_id,
    inserted: 0,
    duplicates: 0,
    skipped_must_haves: 0,
    skipped_budget: 0,
  };
  const source = await loadWorkspaceSignalSource(
    deps.pool,
    input.workspace_id,
    input.source_id,
  );
  if (!source) {
    summary.error = "source not found";
    return {
      summary,
      discovery: null,
      items: [],
      cursor: {},
      save_cursor: false,
    };
  }
  const adapterId =
    typeof source.config.adapter === "string" && source.config.adapter.trim()
      ? source.config.adapter.trim()
      : source.kind;
  const adapter = getWorkspaceAdapter(adapterId);
  if (!adapter) {
    summary.error = `no workspace adapter for '${adapterId}'`;
    return {
      summary,
      discovery: null,
      items: [],
      cursor: {},
      save_cursor: false,
    };
  }
  const cursor = await loadWsCursor(deps.pool, input.workspace_id, input.source_id);
  const discovery = await prepareWorkspaceSignalDiscoveryContext(deps, {
    workspace_id: input.workspace_id,
    source,
    adapter_id: adapter.id,
    kind_hint: adapter.kindHint,
  });

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
    return {
      summary,
      discovery: null,
      items: [],
      cursor,
      save_cursor: false,
    };
  }

  const items = selectNextWorkspacePollItems(
    pollResult.items,
    cursor,
    maxItemsPerPoll(source.config),
  ).map(compactPreparedItem);
  return {
    summary,
    discovery,
    items,
    cursor: buildNextCursor(cursor, pollResult.cursor, pollResult.items, items),
    save_cursor: true,
  };
}

async function processPreparedWorkspacePoll(
  deps: WorkspacePollDeps,
  prepared: WorkspacePollPreparation,
): Promise<WorkspacePollSummary> {
  const summary = { ...prepared.summary };
  if (prepared.discovery) {
    for (const item of prepared.items) {
      const result = await discoverWorkspaceSignal(deps, prepared.discovery, item);
      applyDiscoveryResult(summary, result);
    }
  }

  if (prepared.save_cursor) {
    await saveWsCursor(
      deps.pool,
      summary.workspace_id,
      summary.source_id,
      prepared.cursor,
      null,
    );
  }

  return summary;
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
      const prepared = await ctx.step(
        "prepare_poll",
        () => prepareWorkspacePoll(deps, input),
        {
          retry: { max_attempts: 2, backoff: "exponential", base_ms: 200 },
        },
      );
      const summary = { ...prepared.summary };
      if (prepared.discovery) {
        for (const item of prepared.items) {
          const result = await ctx.step(
            `discover:${stableStepSuffix(item.external_id)}`,
            () => discoverWorkspaceSignal(deps, prepared.discovery!, item),
            {
              retry: { max_attempts: 2, backoff: "exponential", base_ms: 200 },
            },
          );
          applyDiscoveryResult(summary, result);
        }
      }
      if (prepared.save_cursor) {
        await ctx.step(
          "save_cursor",
          () => saveWsCursor(
            deps.pool,
            input.workspace_id,
            input.source_id,
            prepared.cursor,
            null,
          ),
          {
            retry: { max_attempts: 2, backoff: "exponential", base_ms: 200 },
          },
        );
      }
      return summary;
    },
  });
}

function applyDiscoveryResult(
  summary: WorkspacePollSummary,
  result: Awaited<ReturnType<typeof discoverWorkspaceSignal>>,
): void {
  if (result.outcome === "created") summary.inserted += 1;
  if (result.outcome === "skipped:dedup") summary.duplicates += 1;
  if (result.outcome === "skipped:must_haves") summary.skipped_must_haves += 1;
  if (result.outcome === "skipped:budget") summary.skipped_budget += 1;
}

export function maxItemsPerPoll(config: Record<string, unknown>): number {
  const raw = config.max_items_per_poll;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_MAX_ITEMS_PER_POLL;
  return Math.min(Math.floor(value), HARD_MAX_ITEMS_PER_POLL);
}

export function selectNextWorkspacePollItems(
  items: WorkspaceSignalDiscoveryItem[],
  cursor: Record<string, unknown>,
  maxItems: number,
): WorkspaceSignalDiscoveryItem[] {
  const seen = cursorSeenExternalIds(cursor);
  const selected: WorkspaceSignalDiscoveryItem[] = [];
  for (const item of items) {
    if (seen.has(item.external_id)) continue;
    selected.push(item);
    if (selected.length >= maxItems) break;
  }
  return selected;
}

function compactPreparedItem(
  item: WorkspaceSignalDiscoveryItem,
): WorkspaceSignalDiscoveryItem {
  return {
    ...item,
    content: item.content ? item.content.slice(0, MAX_PREPARED_CONTENT_CHARS) : item.content,
  };
}

export function buildNextCursor(
  previousCursor: Record<string, unknown>,
  adapterCursor: Record<string, unknown>,
  polledItems: WorkspaceSignalDiscoveryItem[],
  selectedItems: WorkspaceSignalDiscoveryItem[],
): Record<string, unknown> {
  const currentIds = new Set(polledItems.map((item) => item.external_id));
  const seen = [...cursorSeenExternalIds(previousCursor)]
    .filter((externalId) => currentIds.has(externalId));
  for (const item of selectedItems) {
    if (!seen.includes(item.external_id)) seen.push(item.external_id);
  }
  return {
    ...adapterCursor,
    seen_external_ids: seen.slice(-500),
    selected_count: selectedItems.length,
    polled_count: polledItems.length,
  };
}

function cursorSeenExternalIds(cursor: Record<string, unknown>): Set<string> {
  const raw = cursor.seen_external_ids;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((value): value is string => typeof value === "string"));
}

function stableStepSuffix(externalId: string): string {
  return createHash("sha256").update(externalId).digest("hex").slice(0, 16);
}
