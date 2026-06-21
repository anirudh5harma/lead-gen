import type { Pool } from "pg";
import type { SignalKind } from "../primitives/signal.ts";
import type {
  DurableEventProjection,
  EventBus,
  PublishedEvent,
} from "../substrate/events/index.ts";
import { loadLearnedSignalKindModifier } from "./feedback.ts";

export interface SignalIntentKindConfig {
  base_strength: number;
  half_life_hours: number;
  description: string;
}

/**
 * GTM-grounded intent prior by signal kind. Stronger, harder-to-fake buying
 * or change-of-motion signals start higher and decay on a kind-specific half
 * life; soft awareness signals start lower and fade quickly.
 */
export const SIGNAL_KIND_INTENT_CONFIG = {
  funding: {
    base_strength: 1,
    half_life_hours: 21 * 24,
    description: "Fresh funding usually signals budget, hiring, and stack change.",
  },
  hiring: {
    base_strength: 0.92,
    half_life_hours: 10 * 24,
    description: "A surge of GTM hiring is a strong workflow-change trigger.",
  },
  leadership_change: {
    base_strength: 0.88,
    half_life_hours: 14 * 24,
    description: "New executive ownership often resets tooling and process.",
  },
  product_launch: {
    base_strength: 0.74,
    half_life_hours: 7 * 24,
    description: "Launches matter, but urgency fades faster than financing or org change.",
  },
  acquisition: {
    base_strength: 0.84,
    half_life_hours: 21 * 24,
    description: "Acquisition and integration work can create real evaluation windows.",
  },
  churn_risk: {
    base_strength: 0.96,
    half_life_hours: 5 * 24,
    description: "Active dissatisfaction is urgent and commercially strong, but short-lived.",
  },
  competitor_move: {
    base_strength: 0.9,
    half_life_hours: 7 * 24,
    description: "Competitor-switching motion is valuable while the evaluation is active.",
  },
  podcast_mention: {
    base_strength: 0.32,
    half_life_hours: 5 * 24,
    description: "A single podcast mention is useful context, not strong standalone intent.",
  },
  press_mention: {
    base_strength: 0.22,
    half_life_hours: 4 * 24,
    description: "Broad press awareness is weak unless stacked with stronger signals.",
  },
  regulation: {
    base_strength: 0.7,
    half_life_hours: 14 * 24,
    description: "Compliance deadlines can create meaningful but slower-moving demand.",
  },
  expansion: {
    base_strength: 0.82,
    half_life_hours: 14 * 24,
    description: "New markets, offices, or geo moves often precede GTM system changes.",
  },
  layoff: {
    base_strength: 0.58,
    half_life_hours: 10 * 24,
    description: "Layoffs can change priorities, but urgency is more situational.",
  },
  other: {
    base_strength: 0.4,
    half_life_hours: 7 * 24,
    description: "Catch-all signals should never outrank the explicit GTM triggers above.",
  },
} as const satisfies Record<SignalKind, SignalIntentKindConfig>;

export const LIVE_SIGNAL_STATUSES = ["ingested", "matched", "in_play"] as const;

export interface SignalIntentScoreInput {
  signal_id?: string;
  kind: SignalKind | null;
  freshness_at: string | Date;
  match_score?: number | null;
  audience_confidence?: number | null;
  kind_modifier?: number | null;
}

export interface SignalIntentContribution {
  signal_id: string | null;
  kind: SignalKind | null;
  freshness_at: string;
  age_hours: number;
  icp_fit: number;
  kind_modifier: number;
  base_strength: number;
  half_life_hours: number;
  decayed_strength: number;
  intent_score: number;
}

export interface AccountCompositeIntentScore {
  composite_score: number;
  live_signal_count: number;
  strongest_signal_score: number;
  latest_signal_freshness_at: string | null;
  contributions: SignalIntentContribution[];
}

export interface RankedAccountIntent {
  company_id: string;
  company_name: string;
  normalized_domain: string | null;
  composite_score: number;
  materialized_composite_score: number;
  live_signal_count: number;
  strongest_signal_score: number;
  latest_signal_freshness_at: string | null;
}

interface AccountIntentReadModelRow {
  company_id: string;
  normalized_domain: string | null;
  composite_score: string;
  live_signal_count: number;
  strongest_signal_score: string;
  latest_signal_freshness_at: Date | null;
  last_score_event_id: string | null;
}

interface AccountIntentCompanyRow {
  id: string;
  name: string;
  domain: string | null;
}

interface AccountIntentSignalRow {
  company_id: string;
  signal_id: string;
  kind: SignalKind | null;
  match_score: string | null;
  audience_hint: Record<string, unknown> | null;
  freshness_at: Date;
}

type AccountIntentEventType =
  | "signal.ingested"
  | "signal.matched"
  | "signal.dismissed"
  | "signal.expired"
  | "signal.company.linked";

interface AccountIntentProjectionResult {
  company_id: string;
  normalized_domain: string | null;
  composite_score: number;
  live_signal_count: number;
  strongest_signal_score: number;
  latest_signal_freshness_at: string | null;
  score_changed: boolean;
  should_emit: boolean;
  computed_at: string;
}

const LOG2 = Math.log(2);

export function decayedWeight(
  strength: number,
  ageHours: number,
  halfLifeHours: number,
): number {
  if (!Number.isFinite(strength) || strength <= 0) return 0;
  if (!Number.isFinite(halfLifeHours) || halfLifeHours <= 0) return 0;
  const safeAgeHours = Number.isFinite(ageHours) ? Math.max(0, ageHours) : 0;
  return strength * Math.exp(-LOG2 * safeAgeHours / halfLifeHours);
}

export function signalIntentConfigForKind(
  kind: SignalKind | null,
): SignalIntentKindConfig {
  if (!kind) return SIGNAL_KIND_INTENT_CONFIG.other;
  return SIGNAL_KIND_INTENT_CONFIG[kind] ?? SIGNAL_KIND_INTENT_CONFIG.other;
}

export function signalIcpFit(input: {
  match_score?: number | null;
  audience_confidence?: number | null;
}): number {
  const direct = clampNonNegative(input.match_score);
  if (direct !== null) return Math.min(1, direct);
  const fallback = clampNonNegative(input.audience_confidence);
  return fallback === null ? 0 : Math.min(1, fallback);
}

export function scoreSignalIntent(
  input: SignalIntentScoreInput,
  now: Date = new Date(),
): SignalIntentContribution {
  const config = signalIntentConfigForKind(input.kind);
  const kind_modifier = normalizeModifier(input.kind_modifier);
  const freshness_at = asDate(input.freshness_at);
  const age_hours = freshness_at
    ? Math.max(0, (now.getTime() - freshness_at.getTime()) / 3_600_000)
    : 0;
  const icp_fit = signalIcpFit({
    match_score: input.match_score ?? null,
    audience_confidence: input.audience_confidence ?? null,
  });
  const base_strength = roundScore(config.base_strength * kind_modifier);
  const decayed_strength = decayedWeight(
    base_strength,
    age_hours,
    config.half_life_hours,
  );
  return {
    signal_id: input.signal_id ?? null,
    kind: input.kind,
    freshness_at: freshness_at?.toISOString() ?? new Date(0).toISOString(),
    age_hours: roundScore(age_hours),
    icp_fit,
    kind_modifier: roundScore(kind_modifier),
    base_strength,
    half_life_hours: config.half_life_hours,
    decayed_strength: roundScore(decayed_strength),
    intent_score: roundScore(decayed_strength * icp_fit),
  };
}

export function computeAccountCompositeIntentScore(
  signals: readonly SignalIntentScoreInput[],
  now: Date = new Date(),
): AccountCompositeIntentScore {
  const contributions = signals
    .map((signal) => scoreSignalIntent(signal, now))
    .sort(compareSignalIntentContributions);
  const composite_score = roundScore(
    contributions.reduce((sum, signal) => sum + signal.intent_score, 0),
  );
  return {
    composite_score,
    live_signal_count: signals.length,
    strongest_signal_score: contributions[0]?.intent_score ?? 0,
    latest_signal_freshness_at: contributions
      .map((signal) => signal.freshness_at)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
    contributions,
  };
}

export function compareSignalIntentContributions(
  a: SignalIntentContribution,
  b: SignalIntentContribution,
): number {
  return b.intent_score - a.intent_score ||
    Date.parse(b.freshness_at) - Date.parse(a.freshness_at) ||
    (a.signal_id ?? "").localeCompare(b.signal_id ?? "");
}

export function createAccountIntentProjection(
  pool: Pool,
  bus: EventBus,
): DurableEventProjection {
  return {
    name: "account.intent.projector.v1",
    eventTypes: [
      "signal.ingested",
      "signal.matched",
      "signal.dismissed",
      "signal.expired",
      "signal.company.linked",
    ],
    apply: (event) => projectAccountIntentFromEvent(pool, bus, event),
  };
}

export async function projectAccountIntentFromEvent(
  pool: Pool,
  bus: EventBus,
  event: PublishedEvent,
): Promise<void> {
  const eventType = event.event_type as AccountIntentEventType;
  if (
    eventType !== "signal.ingested" &&
    eventType !== "signal.matched" &&
    eventType !== "signal.dismissed" &&
    eventType !== "signal.expired" &&
    eventType !== "signal.company.linked"
  ) {
    return;
  }
  const signal_id = signalIdFromPayload(event.payload);
  if (!signal_id) return;
  const signal = await loadSignalCompanyReference(pool, event.workspace_id, signal_id);
  if (!signal) return;
  if (!signal.company_id) {
    if (eventType === "signal.company.linked") {
      throw new Error(
        `Account intent projection requires company linkage for signal ${signal_id}`,
      );
    }
    return;
  }

  const result = await recomputeAccountIntentReadModel(
    pool,
    event.workspace_id,
    signal.company_id,
    {
      scoreEventId: event.id,
      computedAt: new Date(event.occurred_at),
    },
  );
  if (!result.should_emit) return;

  await bus.publish({
    workspace_id: event.workspace_id,
    event_type: "account.intent.updated",
    source: "system",
    producer_ref: `projection:${event.event_type}`,
    correlation_id: event.correlation_id ?? event.id,
    causation_id: event.id,
    idempotency_key: `projection:${event.id}:account.intent.updated:${result.company_id}`,
    payload: {
      company_id: result.company_id,
      normalized_domain: result.normalized_domain,
      composite_score: result.composite_score,
      live_signal_count: result.live_signal_count,
      strongest_signal_score: result.strongest_signal_score,
      latest_signal_freshness_at: result.latest_signal_freshness_at,
      updated_at: result.computed_at,
    },
  });
}

export async function listAccountsByCompositeIntent(
  pool: Pool,
  workspace_id: string,
  opts: {
    limit?: number;
    now?: Date;
    candidate_window?: number;
  } = {},
): Promise<RankedAccountIntent[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(opts.limit ?? 25)));
  const candidateWindow = Math.max(
    limit,
    Math.min(1000, Math.trunc(opts.candidate_window ?? Math.max(limit * 5, 200))),
  );
  const now = opts.now ?? new Date();
  const { rows: candidates } = await pool.query<{
    company_id: string;
    company_name: string;
    normalized_domain: string | null;
    materialized_composite_score: string;
  }>(
    `select ais.company_id::text as company_id,
            gc.name as company_name,
            ais.normalized_domain::text as normalized_domain,
            ais.composite_score::text as materialized_composite_score
       from account_intent_scores ais
       join graph_companies gc
         on gc.workspace_id = ais.workspace_id
        and gc.id = ais.company_id
      where ais.workspace_id = $1
        and ais.live_signal_count > 0
      order by ais.composite_score desc,
               ais.latest_signal_freshness_at desc nulls last,
               gc.name asc
      limit $2`,
    [workspace_id, candidateWindow],
  );
  if (candidates.length === 0) return [];

  const companyIds = candidates.map((row) => row.company_id);
  const { rows: signals } = await pool.query<AccountIntentSignalRow>(
    `select related_company_id::text as company_id,
            id::text as signal_id,
            kind::text as kind,
            match_score::text as match_score,
            audience_hint,
            freshness_at
       from signals
      where workspace_id = $1
        and related_company_id = any($2::uuid[])
        and status = any($3::signal_status[])`,
    [workspace_id, companyIds, [...LIVE_SIGNAL_STATUSES]],
  );
  const kindModifiers = await loadSignalKindModifiers(
    pool,
    workspace_id,
    signals.map((signal) => signal.kind),
  );
  const signalsByCompany = new Map<string, SignalIntentScoreInput[]>();
  for (const signal of signals) {
    const entries = signalsByCompany.get(signal.company_id) ?? [];
    entries.push({
      signal_id: signal.signal_id,
      kind: signal.kind,
      match_score: parseNumeric(signal.match_score),
      audience_confidence: audienceConfidence(signal.audience_hint),
      freshness_at: signal.freshness_at,
      kind_modifier: signal.kind ? kindModifiers.get(signal.kind) ?? 1 : 1,
    });
    signalsByCompany.set(signal.company_id, entries);
  }

  const ranked = candidates.map<RankedAccountIntent>((candidate) => {
    const snapshot = computeAccountCompositeIntentScore(
      signalsByCompany.get(candidate.company_id) ?? [],
      now,
    );
    return {
      company_id: candidate.company_id,
      company_name: candidate.company_name,
      normalized_domain: candidate.normalized_domain,
      composite_score: snapshot.composite_score,
      materialized_composite_score: parseNumeric(candidate.materialized_composite_score) ?? 0,
      live_signal_count: snapshot.live_signal_count,
      strongest_signal_score: snapshot.strongest_signal_score,
      latest_signal_freshness_at: snapshot.latest_signal_freshness_at,
    };
  });

  ranked.sort((a, b) =>
    b.composite_score - a.composite_score ||
    b.live_signal_count - a.live_signal_count ||
    Date.parse(b.latest_signal_freshness_at ?? new Date(0).toISOString()) -
      Date.parse(a.latest_signal_freshness_at ?? new Date(0).toISOString()) ||
    a.company_name.localeCompare(b.company_name)
  );

  return ranked.slice(0, limit);
}

export function sortSignalsByIntentScore<T extends SignalIntentScoreInput>(
  signals: readonly T[],
  now: Date = new Date(),
): T[] {
  return [...signals].sort((a, b) => {
    const left = scoreSignalIntent(a, now);
    const right = scoreSignalIntent(b, now);
    return compareSignalIntentContributions(left, right);
  });
}

async function recomputeAccountIntentReadModel(
  pool: Pool,
  workspace_id: string,
  company_id: string,
  opts: {
    scoreEventId: string;
    computedAt: Date;
  },
): Promise<AccountIntentProjectionResult> {
  const company = await loadAccountIntentCompany(pool, workspace_id, company_id);
  if (!company) {
    throw new Error(
      `Account intent projection rejected missing company ${company_id} in workspace ${workspace_id}`,
    );
  }
  const signals = await loadLiveSignalsForCompany(pool, workspace_id, company_id);
  const kindModifiers = await loadSignalKindModifiers(
    pool,
    workspace_id,
    signals.map((signal) => signal.kind),
  );
  const snapshot = computeAccountCompositeIntentScore(
    signals.map((signal) => ({
      signal_id: signal.signal_id,
      kind: signal.kind,
      match_score: parseNumeric(signal.match_score),
      audience_confidence: audienceConfidence(signal.audience_hint),
      freshness_at: signal.freshness_at,
      kind_modifier: signal.kind ? kindModifiers.get(signal.kind) ?? 1 : 1,
    })),
    opts.computedAt,
  );
  const existing = await loadAccountIntentReadModel(pool, workspace_id, company_id);
  const priorScore = existing ? parseNumeric(existing.composite_score) ?? 0 : 0;
  const score_changed = existing
    ? priorScore !== snapshot.composite_score
    : snapshot.composite_score !== 0;
  const state_changed = !existing ||
    priorScore !== snapshot.composite_score ||
    existing.live_signal_count !== snapshot.live_signal_count ||
    (parseNumeric(existing.strongest_signal_score) ?? 0) !== snapshot.strongest_signal_score ||
    existing.normalized_domain !== company.domain ||
    isoOrNull(existing.latest_signal_freshness_at) !== snapshot.latest_signal_freshness_at;

  if (state_changed) {
    const last_score_event_id = score_changed
      ? opts.scoreEventId
      : existing?.last_score_event_id ?? null;
    await pool.query(
      `insert into account_intent_scores (
         workspace_id,
         company_id,
         normalized_domain,
         composite_score,
         live_signal_count,
         strongest_signal_score,
         latest_signal_freshness_at,
         last_score_event_id,
         updated_at
       ) values (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         now()
       )
       on conflict (workspace_id, company_id)
       do update set
         normalized_domain = excluded.normalized_domain,
         composite_score = excluded.composite_score,
         live_signal_count = excluded.live_signal_count,
         strongest_signal_score = excluded.strongest_signal_score,
         latest_signal_freshness_at = excluded.latest_signal_freshness_at,
         last_score_event_id = excluded.last_score_event_id,
         updated_at = now()`,
      [
        workspace_id,
        company_id,
        company.domain,
        snapshot.composite_score,
        snapshot.live_signal_count,
        snapshot.strongest_signal_score,
        snapshot.latest_signal_freshness_at,
        last_score_event_id,
      ],
    );
  }

  return {
    company_id,
    normalized_domain: company.domain,
    composite_score: snapshot.composite_score,
    live_signal_count: snapshot.live_signal_count,
    strongest_signal_score: snapshot.strongest_signal_score,
    latest_signal_freshness_at: snapshot.latest_signal_freshness_at,
    score_changed,
    should_emit: score_changed || existing?.last_score_event_id === opts.scoreEventId,
    computed_at: opts.computedAt.toISOString(),
  };
}

async function loadSignalCompanyReference(
  pool: Pool,
  workspace_id: string,
  signal_id: string,
): Promise<{ company_id: string | null } | null> {
  const { rows } = await pool.query<{ company_id: string | null }>(
    `select related_company_id::text as company_id
       from signals
      where workspace_id = $1
        and id = $2
      limit 1`,
    [workspace_id, signal_id],
  );
  return rows[0] ?? null;
}

async function loadLiveSignalsForCompany(
  pool: Pool,
  workspace_id: string,
  company_id: string,
): Promise<AccountIntentSignalRow[]> {
  const { rows } = await pool.query<AccountIntentSignalRow>(
    `select related_company_id::text as company_id,
            id::text as signal_id,
            kind::text as kind,
            match_score::text as match_score,
            audience_hint,
            freshness_at
       from signals
      where workspace_id = $1
        and related_company_id = $2
        and status = any($3::signal_status[])`,
    [workspace_id, company_id, [...LIVE_SIGNAL_STATUSES]],
  );
  return rows;
}

async function loadAccountIntentReadModel(
  pool: Pool,
  workspace_id: string,
  company_id: string,
): Promise<AccountIntentReadModelRow | null> {
  const { rows } = await pool.query<AccountIntentReadModelRow>(
    `select company_id::text as company_id,
            normalized_domain::text as normalized_domain,
            composite_score::text as composite_score,
            live_signal_count,
            strongest_signal_score::text as strongest_signal_score,
            latest_signal_freshness_at,
            last_score_event_id::text as last_score_event_id
       from account_intent_scores
      where workspace_id = $1
        and company_id = $2
      limit 1`,
    [workspace_id, company_id],
  );
  return rows[0] ?? null;
}

async function loadAccountIntentCompany(
  pool: Pool,
  workspace_id: string,
  company_id: string,
): Promise<AccountIntentCompanyRow | null> {
  const { rows } = await pool.query<AccountIntentCompanyRow>(
    `select id::text as id,
            name,
            domain::text as domain
       from graph_companies
      where workspace_id = $1
        and id = $2
      limit 1`,
    [workspace_id, company_id],
  );
  return rows[0] ?? null;
}

function signalIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const signal_id = (payload as { signal_id?: unknown }).signal_id;
  return typeof signal_id === "string" && signal_id ? signal_id : null;
}

function audienceConfidence(
  audience_hint: Record<string, unknown> | null | undefined,
): number | null {
  if (!audience_hint) return null;
  return clampNonNegative(audience_hint.confidence);
}

function parseNumeric(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadSignalKindModifiers(
  pool: Pool,
  workspace_id: string,
  kinds: readonly (SignalKind | null)[],
): Promise<Map<SignalKind, number>> {
  const uniqueKinds = [...new Set(kinds.filter((kind): kind is SignalKind => kind !== null))];
  const modifiers = await Promise.all(
    uniqueKinds.map(async (kind) => {
      return [kind, await loadLearnedSignalKindModifier(pool, workspace_id, kind)] as const;
    }),
  );
  return new Map(modifiers);
}

function clampNonNegative(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeModifier(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function asDate(value: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}
