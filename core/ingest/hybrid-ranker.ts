import type { Pool } from "pg";
import type { SignalKind } from "../primitives/signal.ts";
import type { IcpRow } from "./icps.ts";
import { evaluateMustHaves } from "./icp-filter.ts";

export interface HybridWeights {
  vec: number;
  graph: number;
  intent: number;
}

export interface HybridGraphWeights {
  same_company_match: number;
  same_company_kind_match: number;
  related_company_link: number;
}

export const HYBRID_WEIGHTS = {
  vec: 0.55,
  graph: 0.3,
  intent: 0.15,
} as const satisfies HybridWeights;

export const HYBRID_GRAPH_WEIGHTS = {
  same_company_match: 0.6,
  same_company_kind_match: 0.3,
  related_company_link: 0.1,
} as const satisfies HybridGraphWeights;

export const HYBRID_RANKER_CONFIG = {
  shortlist_limit: 5,
  history_signal_limit: 250,
  weights: HYBRID_WEIGHTS,
  graph_weights: HYBRID_GRAPH_WEIGHTS,
} as const;

export interface HybridSignalRow {
  id: string;
  workspace_id: string;
  kind: SignalKind | null;
  title: string;
  content: string | null;
  url: string | null;
  properties: Record<string, unknown> | null;
  structured: Record<string, unknown> | null;
  freshness_at: Date;
  related_company_id: string | null;
}

export interface HybridSubScores {
  vec_sim: number;
  graph_prox: number;
  intent_prior: number;
  hybrid_score: number;
  passed_must_haves: boolean;
}

export interface HybridRankableCandidate {
  candidate_id: string;
  vec_sim: number;
  graph_prox: number;
  intent_prior: number;
  passed_must_haves: boolean;
}

export interface HybridGraphEvidence {
  same_company_match_count: number;
  same_company_kind_match_count: number;
  has_related_company_link: boolean;
}

export interface HybridIcpCandidate {
  icp: IcpRow;
  scores: HybridSubScores;
}

export interface HybridShortlist {
  signal_id: string;
  workspace_id: string;
  ranked_candidates: HybridIcpCandidate[];
  shortlist: HybridIcpCandidate[];
}

interface HybridEvidenceRow {
  icp_id: string;
  vec_sim: number | null;
  same_company_match_count: number;
  same_company_kind_match_count: number;
  composite_score: number;
  has_related_company_link: boolean;
}

export function intentPriorFromCompositeScore(
  compositeScore: number | null | undefined,
): number {
  const safe = finiteOrZero(compositeScore);
  if (safe <= 0) return 0;
  return clamp01(safe / (1 + safe));
}

export function graphProximityFromEvidence(
  evidence: HybridGraphEvidence,
  weights: HybridGraphWeights = HYBRID_GRAPH_WEIGHTS,
): number {
  const sameCompany = Math.min(1, Math.max(0, finiteOrZero(evidence.same_company_match_count)));
  const sameCompanyKind = Math.min(
    1,
    Math.max(0, finiteOrZero(evidence.same_company_kind_match_count)),
  );
  return clamp01(
    sameCompany * weights.same_company_match +
      sameCompanyKind * weights.same_company_kind_match +
      (evidence.has_related_company_link ? weights.related_company_link : 0),
  );
}

export function computeHybridScore(
  candidate: Pick<
    HybridRankableCandidate,
    "vec_sim" | "graph_prox" | "intent_prior" | "passed_must_haves"
  >,
  weights: HybridWeights = HYBRID_WEIGHTS,
): number {
  if (!candidate.passed_must_haves) return 0;
  return clamp01(
    clamp01(candidate.vec_sim) * weights.vec +
      clamp01(candidate.graph_prox) * weights.graph +
      clamp01(candidate.intent_prior) * weights.intent,
  );
}

export function rankHybridCandidates<T extends HybridRankableCandidate>(
  candidates: readonly T[],
  weights: HybridWeights = HYBRID_WEIGHTS,
): Array<T & { hybrid_score: number }> {
  return candidates
    .filter((candidate) => candidate.passed_must_haves)
    .map((candidate) => ({
      ...candidate,
      vec_sim: clamp01(candidate.vec_sim),
      graph_prox: clamp01(candidate.graph_prox),
      intent_prior: clamp01(candidate.intent_prior),
      hybrid_score: computeHybridScore(candidate, weights),
    }))
    .sort((a, b) =>
      b.hybrid_score - a.hybrid_score ||
      a.candidate_id.localeCompare(b.candidate_id)
    );
}

export async function buildHybridIcpShortlist(
  pool: Pool,
  input: {
    signal: HybridSignalRow;
    icps: readonly IcpRow[];
    shortlist_limit?: number;
    history_signal_limit?: number;
  },
): Promise<HybridShortlist> {
  const shortlistLimit = normalizedShortlistLimit(input.shortlist_limit);
  const rankedIcpCandidates = input.icps.map((icp) => ({
    icp,
    passed_must_haves: evaluateMustHaves(icp, signalPredicateContext(input.signal)).passed,
  }));
  const passingIcps = rankedIcpCandidates
    .filter((candidate) => candidate.passed_must_haves)
    .map((candidate) => candidate.icp);

  if (passingIcps.length === 0) {
    return {
      signal_id: input.signal.id,
      workspace_id: input.signal.workspace_id,
      ranked_candidates: [],
      shortlist: [],
    };
  }

  const evidenceByIcp = await loadHybridEvidence(pool, {
    signal_id: input.signal.id,
    workspace_id: input.signal.workspace_id,
    icp_ids: passingIcps.map((icp) => icp.id),
    history_signal_limit: normalizedHistoryLimit(input.history_signal_limit),
  });

  const rankedScores = rankHybridCandidates(
    passingIcps.map((icp) => {
      const evidence = evidenceByIcp.get(icp.id);
      return {
        candidate_id: icp.id,
        vec_sim: evidence?.vec_sim ?? 0,
        graph_prox: graphProximityFromEvidence({
          same_company_match_count: evidence?.same_company_match_count ?? 0,
          same_company_kind_match_count: evidence?.same_company_kind_match_count ?? 0,
          has_related_company_link: evidence?.has_related_company_link ?? false,
        }),
        intent_prior: intentPriorFromCompositeScore(evidence?.composite_score ?? 0),
        passed_must_haves: true,
      };
    }),
  );

  const icpById = new Map(passingIcps.map((icp) => [icp.id, icp]));
  const rankedCandidates = rankedScores.map<HybridIcpCandidate>((candidate) => ({
    icp: icpById.get(candidate.candidate_id)!,
    scores: {
      vec_sim: candidate.vec_sim,
      graph_prox: candidate.graph_prox,
      intent_prior: candidate.intent_prior,
      hybrid_score: candidate.hybrid_score,
      passed_must_haves: candidate.passed_must_haves,
    },
  }));

  return {
    signal_id: input.signal.id,
    workspace_id: input.signal.workspace_id,
    ranked_candidates: rankedCandidates,
    shortlist: rankedCandidates.slice(0, shortlistLimit),
  };
}

async function loadHybridEvidence(
  pool: Pool,
  input: {
    signal_id: string;
    workspace_id: string;
    icp_ids: readonly string[];
    history_signal_limit: number;
  },
): Promise<Map<string, HybridEvidenceRow>> {
  if (input.icp_ids.length === 0) return new Map();

  const { rows } = await pool.query<HybridEvidenceRow>(
    `with current_signal as (
       select id,
              workspace_id,
              kind::text as kind,
              related_company_id,
              embedding
         from signals
        where id = $1
          and workspace_id = $2
     ),
     historical_signals as (
       select hist.id,
              hist.kind::text as kind,
              hist.related_company_id,
              hist.embedding,
              hist.audience_hint,
              hist.freshness_at
         from signals hist
         join current_signal cur
           on cur.workspace_id = hist.workspace_id
        where hist.id <> cur.id
          and hist.status in ('matched', 'in_play', 'spent')
          and (
            hist.embedding is not null
            or (
              cur.related_company_id is not null
              and hist.related_company_id = cur.related_company_id
            )
          )
        order by hist.freshness_at desc
        limit $4
     ),
     historical_matches as (
       select hist.id as signal_id,
              hist.kind,
              hist.related_company_id,
              hist.embedding,
              coalesce(match_entry->>'icp_id', match_entry->>'icp_segment') as icp_id
         from historical_signals hist
         cross join lateral jsonb_array_elements(
           coalesce(hist.audience_hint->'matched_icps', '[]'::jsonb)
         ) as match_entry
        where coalesce(match_entry->>'icp_id', match_entry->>'icp_segment') is not null
     ),
     successful_historical_matches as (
       select hist.*
         from historical_matches hist
        where exists (
          select 1
            from outcomes positive_outcome
           where positive_outcome.workspace_id = $2
             and positive_outcome.attributed_signal_id = hist.signal_id
             and positive_outcome.kind in (
               'positive_reply','meeting_booked','opportunity_created','deal_won'
             )
        )
     )
     select candidate.icp_id::text as icp_id,
            (
              select max(1 - (hist.embedding <=> cur.embedding))::float8
                from historical_matches hist
               where cur.embedding is not null
                 and hist.embedding is not null
                 and hist.icp_id = candidate.icp_id::text
            ) as vec_sim,
            coalesce((
              select count(*)::int
                from successful_historical_matches hist
               where cur.related_company_id is not null
                 and hist.related_company_id = cur.related_company_id
                 and hist.icp_id = candidate.icp_id::text
            ), 0) as same_company_match_count,
            coalesce((
              select count(*)::int
                from successful_historical_matches hist
               where cur.related_company_id is not null
                 and cur.kind is not null
                 and hist.related_company_id = cur.related_company_id
                 and hist.kind = cur.kind
                 and hist.icp_id = candidate.icp_id::text
            ), 0) as same_company_kind_match_count,
            coalesce((
              select ais.composite_score::float8
                from account_intent_scores ais
               where ais.workspace_id = cur.workspace_id
                 and ais.company_id = cur.related_company_id
               limit 1
            ), 0) as composite_score,
            (cur.related_company_id is not null) as has_related_company_link
       from unnest($3::uuid[]) as candidate(icp_id)
       cross join current_signal cur
      order by candidate.icp_id asc`,
    [
      input.signal_id,
      input.workspace_id,
      input.icp_ids,
      input.history_signal_limit,
    ],
  );

  return new Map(rows.map((row) => [row.icp_id, row]));
}

function signalPredicateContext(signal: HybridSignalRow): { candidate: Record<string, unknown> } {
  return {
    candidate: {
      kind: signal.kind,
      title: signal.title,
      url: signal.url,
      ...(signalQualityContext(signal) ?? {}),
      structured: signal.structured ?? {},
      freshness_at: signal.freshness_at.toISOString(),
    },
  };
}

function signalQualityContext(signal: HybridSignalRow): Record<string, unknown> | null {
  const properties = signal.properties ?? {};
  const ctx: Record<string, unknown> = {};
  copyIfPresent(ctx, properties, "source_tier");
  copyIfPresent(ctx, properties, "source_authority");
  copyIfPresent(ctx, properties, "source_confidence");
  copyIfPresent(ctx, properties, "source_credibility");
  copyIfPresent(ctx, properties, "buying_intent");
  copyIfPresent(ctx, properties, "timing");
  copyIfPresent(ctx, properties, "signal_quality");
  return Object.keys(ctx).length > 0 ? ctx : null;
}

function copyIfPresent(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  if (source[key] !== undefined && source[key] !== null) {
    target[key] = source[key];
  }
}

function normalizedShortlistLimit(limit: number | undefined): number {
  return Math.max(
    1,
    Math.min(50, Math.trunc(limit ?? HYBRID_RANKER_CONFIG.shortlist_limit)),
  );
}

function normalizedHistoryLimit(limit: number | undefined): number {
  return Math.max(
    25,
    Math.min(1000, Math.trunc(limit ?? HYBRID_RANKER_CONFIG.history_signal_limit)),
  );
}

function finiteOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
