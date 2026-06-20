import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../substrate/events/index.ts";
import {
  ensureBudgetRow,
  recordOverflow,
  reserveCandidate,
} from "./budget.ts";
import { allMatchingIcps } from "./icp-filter.ts";
import {
  findWorkspacesTrackingCompany,
  getTrackedCompany,
} from "./catalog.ts";
import { listIcps } from "./icps.ts";
import { upsertCompany } from "../graph/nodes/companies.ts";
import type { SignalKind } from "../primitives/signal.ts";

/**
 * Fanout: turn a shared signal_candidate into per-workspace `signals` rows
 * by way of a typed `signal.discovered` event. The signal projector
 * (core/ingest/projectors.ts) owns the row INSERT and the downstream
 * `signal.ingested` emission. Fanout owns the orchestration: budget
 * reservation, ICP filter, graph company upsert, audit, idempotency.
 *
 * For each workspace that tracks the candidate's company:
 *   1. Skip if signal_candidate_fanouts already has the (candidate,
 *      workspace) pair (idempotent).
 *   2. Reserve a candidate slot against the workspace's daily budget.
 *      If at cap → audit (signal_overflow) + skipped:budget.
 *   3. Run the structured must-haves filter (cheap, no LLM). The
 *      candidate must match ≥ 1 ICP segment to be of interest.
 *      None match → skipped:must_haves.
 *   4. Upsert the catalog company into the workspace's knowledge graph
 *      so signals.related_company_id can point at a real graph_companies row.
 *   5. Record the fanout audit row (with the chosen signal_id).
 *   6. Publish `signal.discovered` with the full payload + an
 *      idempotency_key derived from (candidate_id, workspace_id) so a
 *      retried fanout never produces a duplicate event.
 */

export interface FanoutCandidate {
  id: string;
  source_id: string;
  kind: SignalKind | null;
  company_id: string | null;
  title: string;
  content: string | null;
  url: string | null;
  structured: Record<string, unknown>;
  novelty_count: number;
  freshness_at: string;
  /** When the candidate has a related person at the company, pass it through. */
  related_person_id?: string | null;
  /** Embedding produced upstream (poll.ts) — passed through to the projector. */
  embedding?: number[] | null;
}

export interface FanoutDeps {
  pool: Pool;
  bus: EventBus;
}

export interface FanoutResult {
  workspace_id: string;
  outcome:
    | "created"
    | "skipped:must_haves"
    | "skipped:budget"
    | "skipped:dedup";
  signal_id?: string;
  matched_icp_ids?: string[];
}

export async function fanoutCandidate(
  deps: FanoutDeps,
  candidate: FanoutCandidate,
): Promise<FanoutResult[]> {
  // The fanout step only handles catalog candidates that have a company_id;
  // without one, the company-keyed lookup has nothing to do.
  if (!candidate.company_id) return [];

  const workspaces = await findWorkspacesTrackingCompany(
    deps.pool,
    candidate.company_id,
  );
  const results: FanoutResult[] = [];
  for (const workspace_id of workspaces) {
    // Idempotency: skip if already fanned out.
    const existing = await deps.pool.query<{
      outcome: string;
      signal_id: string | null;
      signal_status: string | null;
    }>(
      `select f.outcome,
              f.signal_id,
              s.status::text as signal_status
         from signal_candidate_fanouts f
         left join signals s
           on s.workspace_id = f.workspace_id
          and s.id = f.signal_id
        where f.candidate_id = $1 and f.workspace_id = $2`,
      [candidate.id, workspace_id],
    );
    const existingFanout = existing.rows[0];
    const staleCreatedFanout = Boolean(
      existingFanout?.outcome === "created" &&
      (existingFanout.signal_status === "spent" ||
        existingFanout.signal_status === "dismissed"),
    );
    if (existingFanout && !staleCreatedFanout) {
      results.push({
        workspace_id,
        outcome: "skipped:dedup",
        signal_id: existingFanout.signal_id ?? undefined,
      });
      continue;
    }

    // Budget reservation. Ensure a budget row exists so the first
    // fanout into a fresh workspace doesn't no-op for lack of a row.
    await ensureBudgetRow(deps.pool, workspace_id);
    const reserved = await reserveCandidate(deps.pool, workspace_id);
    if (!reserved) {
      await recordOverflow(deps.pool, workspace_id, candidate.source_id, "daily_cap_reached", {
        candidate_id: candidate.id,
        title: candidate.title,
      });
      await recordFanout(deps.pool, candidate.id, workspace_id, null, "skipped:budget");
      results.push({ workspace_id, outcome: "skipped:budget" });
      continue;
    }

    // ICP must-haves filter.
    const icps = await listIcps(deps.pool, workspace_id, { only_enabled: true });
    const filterCtx = {
      candidate: {
        kind: candidate.kind,
        title: candidate.title,
        url: candidate.url,
        company: {
          id: candidate.company_id,
        },
        structured: candidate.structured,
        freshness_at: candidate.freshness_at,
      },
    };
    const matched = icps.length === 0 ? icps : allMatchingIcps(icps, filterCtx);
    // If the workspace has ICPs declared but none match, drop with audit.
    if (icps.length > 0 && matched.length === 0) {
      await recordFanout(deps.pool, candidate.id, workspace_id, null, "skipped:must_haves");
      results.push({ workspace_id, outcome: "skipped:must_haves" });
      continue;
    }

    // Upsert the catalog company into the workspace's knowledge graph so
    // signals.related_company_id points at a real graph_companies row.
    let related_company_id: string | null = null;
    if (candidate.company_id) {
      const tracked = await getTrackedCompany(deps.pool, candidate.company_id);
      if (tracked) {
        const graphCo = await upsertCompany(deps.pool, workspace_id, {
          name: tracked.name,
          domain: tracked.domain ?? undefined,
          industry: tracked.industry ?? undefined,
          size_bucket: tracked.size_bucket ?? undefined,
          provenance: {
            tracked_company_id: tracked.id,
            source: "catalog_fanout",
          },
        });
        related_company_id = graphCo.id;
      }
    }

    // Mint the signal id up front. The audit row uses it (FK was dropped in
    // migration 025) and the projector inserts the row with the same id.
    const signal_id = randomUUID();
    const fanoutIdempotencyKey = staleCreatedFanout
      ? `fanout:${candidate.id}:${workspace_id}:reactivated:${candidate.freshness_at}`
      : `fanout:${candidate.id}:${workspace_id}`;
    if (!staleCreatedFanout) {
      await recordFanout(deps.pool, candidate.id, workspace_id, signal_id, "created");
    }

    const event = await deps.bus.publish({
      workspace_id,
      event_type: "signal.discovered",
      source: "system",
      producer_ref: "ingest:catalog",
      idempotency_key: fanoutIdempotencyKey,
      payload: {
        signal_id,
        source_id: null,
        kind: candidate.kind,
        title: candidate.title,
        content: candidate.content,
        url: candidate.url,
        freshness_at: candidate.freshness_at,
        related_company_id,
        related_person_id: candidate.related_person_id ?? null,
        origin_candidate_id: candidate.id,
        properties: {
          structured: candidate.structured,
          novelty_count: candidate.novelty_count,
          tracked_company_id: candidate.company_id,
        },
        provenance: { source: "catalog_fanout", candidate_id: candidate.id },
        embedding: candidate.embedding ?? null,
      },
    });
    const publishedSignalId =
      typeof event.payload.signal_id === "string" ? event.payload.signal_id : signal_id;
    if (staleCreatedFanout) {
      await recordFanout(
        deps.pool,
        candidate.id,
        workspace_id,
        publishedSignalId,
        "created",
        true,
      );
    }

    results.push({
      workspace_id,
      outcome: "created",
      signal_id: publishedSignalId,
      matched_icp_ids: matched.map((i) => i.id),
    });
  }
  return results;
}

async function recordFanout(
  pool: Pool,
  candidate_id: string,
  workspace_id: string,
  signal_id: string | null,
  outcome: string,
  replaceExisting = false,
): Promise<void> {
  if (replaceExisting) {
    await pool.query(
      `update signal_candidate_fanouts
          set signal_id = $3,
              outcome   = $4,
              fanned_at = now()
        where candidate_id = $1
          and workspace_id = $2`,
      [candidate_id, workspace_id, signal_id, outcome],
    );
    return;
  }
  await pool.query(
    `insert into signal_candidate_fanouts (candidate_id, workspace_id, signal_id, outcome)
     values ($1, $2, $3, $4)
     on conflict (candidate_id, workspace_id) do nothing`,
    [candidate_id, workspace_id, signal_id, outcome],
  );
}
