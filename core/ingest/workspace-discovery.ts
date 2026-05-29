import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../substrate/events/index.ts";
import type { SignalKind } from "../primitives/signal.ts";
import type { EmbeddingClient } from "./embeddings.ts";
import type { IcpRow } from "./icps.ts";
import type { RawCandidate } from "./types.ts";
import {
  ensureBudgetRow,
  recordOverflow,
  reserveCandidate,
} from "./budget.ts";
import { allMatchingIcps } from "./icp-filter.ts";
import { listIcps } from "./icps.ts";

export interface WorkspaceSignalSourceRow {
  id: string;
  workspace_id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
}

export interface WorkspaceSignalDiscoveryDeps {
  pool: Pool;
  bus: EventBus;
  embedder: EmbeddingClient;
}

export interface WorkspaceSignalDiscoveryContext {
  workspace_id: string;
  source: WorkspaceSignalSourceRow;
  adapter_id: string;
  kind_hint: SignalKind | null;
  icps: IcpRow[];
}

export interface WorkspaceSignalDiscoveryItem extends RawCandidate {
  related_company_id?: string | null;
  related_person_id?: string | null;
  properties?: Record<string, unknown>;
  producer_ref?: string;
  idempotency_key?: string;
}

export type WorkspaceSignalDiscoveryResult =
  | {
      outcome: "created";
      signal_id: string;
      event_id: string;
    }
  | {
      outcome: "skipped:dedup";
      signal_id?: string;
    }
  | { outcome: "skipped:must_haves" }
  | { outcome: "skipped:budget" };

export async function loadWorkspaceSignalSource(
  pool: Pool,
  workspace_id: string,
  source_id: string,
): Promise<WorkspaceSignalSourceRow | null> {
  const { rows } = await pool.query<WorkspaceSignalSourceRow>(
    `select id, workspace_id, kind::text as kind, name, config
       from graph_sources
      where workspace_id = $1 and id = $2 and enabled`,
    [workspace_id, source_id],
  );
  return rows[0] ?? null;
}

export async function createWorkspaceSignalDiscoveryContext(
  deps: WorkspaceSignalDiscoveryDeps,
  input: {
    workspace_id: string;
    source_id: string;
    adapter_id?: string | null;
    kind_hint?: SignalKind | null;
  },
): Promise<WorkspaceSignalDiscoveryContext | null> {
  const source = await loadWorkspaceSignalSource(
    deps.pool,
    input.workspace_id,
    input.source_id,
  );
  if (!source) return null;
  return prepareWorkspaceSignalDiscoveryContext(deps, {
    workspace_id: input.workspace_id,
    source,
    adapter_id: input.adapter_id,
    kind_hint: input.kind_hint,
  });
}

export async function prepareWorkspaceSignalDiscoveryContext(
  deps: WorkspaceSignalDiscoveryDeps,
  input: {
    workspace_id: string;
    source: WorkspaceSignalSourceRow;
    adapter_id?: string | null;
    kind_hint?: SignalKind | null;
  },
): Promise<WorkspaceSignalDiscoveryContext> {
  await ensureBudgetRow(deps.pool, input.workspace_id);
  const icps = await listIcps(deps.pool, input.workspace_id, { only_enabled: true });
  return {
    workspace_id: input.workspace_id,
    source: input.source,
    adapter_id:
      input.adapter_id ??
      (typeof input.source.config.adapter === "string" &&
      input.source.config.adapter.trim()
        ? input.source.config.adapter.trim()
        : input.source.kind),
    kind_hint: input.kind_hint ?? parseConfiguredSignalKind(input.source.config),
    icps,
  };
}

export async function discoverWorkspaceSignal(
  deps: WorkspaceSignalDiscoveryDeps,
  ctx: WorkspaceSignalDiscoveryContext,
  item: WorkspaceSignalDiscoveryItem,
): Promise<WorkspaceSignalDiscoveryResult> {
  const existing = await existingSignalId(
    deps.pool,
    ctx.workspace_id,
    ctx.source.id,
    item.external_id,
  );
  if (existing) {
    return { outcome: "skipped:dedup", signal_id: existing };
  }

  const itemKind = item.kind ?? ctx.kind_hint;
  const filterCtx = {
    candidate: {
      kind: itemKind,
      title: item.title,
      url: item.url,
      structured: item.structured ?? {},
      freshness_at: item.freshness_at,
    },
  };
  if (ctx.icps.length > 0 && allMatchingIcps(ctx.icps, filterCtx).length === 0) {
    return { outcome: "skipped:must_haves" };
  }

  const reserved = await reserveCandidate(deps.pool, ctx.workspace_id);
  if (!reserved) {
    await recordOverflow(
      deps.pool,
      ctx.workspace_id,
      ctx.source.id,
      "daily_cap_reached",
      { external_id: item.external_id, title: item.title },
    );
    return { outcome: "skipped:budget" };
  }

  const leadText = `${item.title} ${(item.content ?? "").slice(0, 200)}`.trim();
  const [embedding] = await deps.embedder.embed([leadText]);
  const signal_id = randomUUID();
  const event = await deps.bus.publish({
    workspace_id: ctx.workspace_id,
    event_type: "signal.discovered",
    source: "system",
    producer_ref: item.producer_ref ?? `ingest:workspace:${ctx.adapter_id}`,
    idempotency_key:
      item.idempotency_key ?? `workspace-source:${ctx.source.id}:external:${item.external_id}`,
    payload: {
      signal_id,
      source_id: ctx.source.id,
      kind: itemKind ?? null,
      title: item.title,
      content: item.content ?? null,
      url: item.url ?? null,
      freshness_at: item.freshness_at,
      related_company_id: item.related_company_id ?? null,
      related_person_id: item.related_person_id ?? null,
      origin_candidate_id: null,
      properties: {
        ...(item.properties ?? {}),
        structured: item.structured ?? item.properties?.structured ?? {},
      },
      provenance: {
        adapter: ctx.adapter_id,
        external_id: item.external_id,
        ...(item.provenance ?? {}),
      },
      embedding,
    },
  });
  const publishedSignalId =
    typeof event.payload.signal_id === "string" ? event.payload.signal_id : signal_id;
  return { outcome: "created", signal_id: publishedSignalId, event_id: event.id };
}

export async function discoverWorkspaceSignalOnce(
  deps: WorkspaceSignalDiscoveryDeps,
  input: WorkspaceSignalDiscoveryItem & {
    workspace_id: string;
    source_id: string;
  },
): Promise<WorkspaceSignalDiscoveryResult | { outcome: "skipped:source_not_found" }> {
  const ctx = await createWorkspaceSignalDiscoveryContext(deps, {
    workspace_id: input.workspace_id,
    source_id: input.source_id,
  });
  if (!ctx) return { outcome: "skipped:source_not_found" };
  return discoverWorkspaceSignal(deps, ctx, input);
}

async function existingSignalId(
  pool: Pool,
  workspace_id: string,
  source_id: string,
  external_id: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from signals
      where workspace_id = $1
        and source_id    = $2
        and provenance->>'external_id' = $3
      limit 1`,
    [workspace_id, source_id, external_id],
  );
  return rows[0]?.id ?? null;
}

function parseConfiguredSignalKind(config: Record<string, unknown>): SignalKind | null {
  const value = config.kind ?? config.signal_kind;
  return isSignalKind(value) ? value : null;
}

function isSignalKind(value: unknown): value is SignalKind {
  return (
    value === "funding" ||
    value === "hiring" ||
    value === "leadership_change" ||
    value === "product_launch" ||
    value === "acquisition" ||
    value === "churn_risk" ||
    value === "competitor_move" ||
    value === "podcast_mention" ||
    value === "press_mention" ||
    value === "regulation" ||
    value === "expansion" ||
    value === "layoff" ||
    value === "other"
  );
}
