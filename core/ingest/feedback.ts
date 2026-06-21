import type { Pool } from "pg";
import type { OutcomeKind } from "../primitives/outcome.ts";
import type { SignalKind } from "../primitives/signal.ts";
import type {
  DurableEventProjection,
  EventBus,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";

export const SIGNAL_FEEDBACK_PROJECTION = "signal.feedback.projector.v1";
export const SIGNAL_FEEDBACK_ALPHA = 1;
export const SIGNAL_FEEDBACK_BASELINE_RATE = 0.5;
export const SIGNAL_FEEDBACK_MIN_MODIFIER = 0.5;
export const SIGNAL_FEEDBACK_MAX_MODIFIER = 1.5;

const POSITIVE_OUTCOME_KINDS = ["positive_reply", "meeting_booked"] as const satisfies
  readonly OutcomeKind[];

type OutcomeRecordedEvent = PublishedEvent<EventPayload<"outcome.recorded">>;

interface SignalFeedbackCountRow {
  positive_outcomes: number;
  signals_surfaced: number;
}

interface SignalFeedbackAggregateRow extends SignalFeedbackCountRow {
  row_count: number;
}

interface SignalFeedbackStatsUpsertRow extends SignalFeedbackCountRow {
  workspace_id: string | null;
  source: string;
  signal_kind: SignalKind;
  learned_modifier: number;
  last_event_id: string;
}

export interface SignalFeedbackStatsRow extends SignalFeedbackStatsUpsertRow {
  updated_at: string;
}

interface AttributedSignalFeedbackContext {
  signal_id: string;
  source: string;
  signal_kind: SignalKind;
}

export function computeLearnedModifier(
  positive_outcomes: number,
  signals_surfaced: number,
): number {
  const boundedPositive = clampCount(positive_outcomes);
  const boundedSurfaced = clampCount(signals_surfaced);
  const rate = (boundedPositive + SIGNAL_FEEDBACK_ALPHA) /
    (boundedSurfaced + 2 * SIGNAL_FEEDBACK_ALPHA);
  const raw_modifier = rate / SIGNAL_FEEDBACK_BASELINE_RATE;
  return roundModifier(
    clampBetween(
      raw_modifier,
      SIGNAL_FEEDBACK_MIN_MODIFIER,
      SIGNAL_FEEDBACK_MAX_MODIFIER,
    ),
  );
}

export async function loadLearnedSignalKindModifier(
  pool: Pool,
  workspace_id: string,
  signal_kind: SignalKind | null,
): Promise<number> {
  if (!signal_kind) return 1;
  const workspaceStats = await aggregateFeedbackStats(pool, {
    workspace_id,
    signal_kind,
  });
  if (workspaceStats.row_count > 0) {
    return computeLearnedModifier(
      workspaceStats.positive_outcomes,
      workspaceStats.signals_surfaced,
    );
  }
  const globalStats = await aggregateFeedbackStats(pool, {
    workspace_id: null,
    signal_kind,
  });
  return globalStats.row_count > 0
    ? computeLearnedModifier(globalStats.positive_outcomes, globalStats.signals_surfaced)
    : 1;
}

export async function loadLearnedSourceModifier(
  pool: Pool,
  workspace_id: string,
  source: string | null | undefined,
): Promise<number> {
  const normalizedSource = normalizeFeedbackSource(source);
  if (!normalizedSource) return 1;
  const workspaceStats = await aggregateFeedbackStats(pool, {
    workspace_id,
    source: normalizedSource,
  });
  if (workspaceStats.row_count > 0) {
    return computeLearnedModifier(
      workspaceStats.positive_outcomes,
      workspaceStats.signals_surfaced,
    );
  }
  const globalStats = await aggregateFeedbackStats(pool, {
    workspace_id: null,
    source: normalizedSource,
  });
  return globalStats.row_count > 0
    ? computeLearnedModifier(globalStats.positive_outcomes, globalStats.signals_surfaced)
    : 1;
}

// NOTE: core/product/app.ts should register this projector beside the other
// typed product projections when app wiring is in scope. This file keeps the
// integration point explicit without editing that surface per task constraints.
export function createSignalFeedbackProjection(
  pool: Pool,
  bus: EventBus,
): DurableEventProjection {
  return {
    name: SIGNAL_FEEDBACK_PROJECTION,
    eventTypes: ["outcome.recorded"],
    apply: (event) => projectSignalFeedbackFromOutcome(pool, bus, event),
  };
}

export async function projectSignalFeedbackFromOutcome(
  pool: Pool,
  bus: EventBus,
  event: PublishedEvent,
): Promise<void> {
  if (event.event_type !== "outcome.recorded") return;
  const feedback = await loadAttributedSignalFeedbackContext(
    pool,
    event.workspace_id,
    event as OutcomeRecordedEvent,
  );
  if (!feedback) return;

  const workspaceStats = await recomputeSignalFeedbackStats(pool, {
    workspace_id: event.workspace_id,
    source: feedback.source,
    signal_kind: feedback.signal_kind,
    last_event_id: event.id,
  });
  await recomputeSignalFeedbackStats(pool, {
    workspace_id: null,
    source: feedback.source,
    signal_kind: feedback.signal_kind,
    last_event_id: event.id,
  });
  await reflectSourceFeedbackModifiers(pool, event.workspace_id, feedback.source);

  if (!workspaceStats.changed) return;

  await bus.publish({
    workspace_id: event.workspace_id,
    event_type: "signal.feedback.updated",
    source: "system",
    producer_ref: "projection:signal.feedback",
    correlation_id: event.correlation_id ?? event.id,
    causation_id: event.id,
    idempotency_key: `projection:${event.id}:signal.feedback.updated:${feedback.signal_kind}`,
    payload: {
      source: workspaceStats.stats.source,
      signal_kind: workspaceStats.stats.signal_kind,
      positive_outcomes: workspaceStats.stats.positive_outcomes,
      signals_surfaced: workspaceStats.stats.signals_surfaced,
      learned_modifier: workspaceStats.stats.learned_modifier,
      updated_at: workspaceStats.stats.updated_at,
    },
  });
}

async function reflectSourceFeedbackModifiers(
  pool: Pool,
  workspace_id: string,
  source: string,
): Promise<void> {
  const workspaceModifier = await loadScopedSourceModifier(pool, workspace_id, source);
  const globalModifier = await loadScopedSourceModifier(pool, null, source);
  await persistWorkspaceSourceModifier(pool, workspace_id, source, workspaceModifier);
  await persistGlobalSourceModifier(pool, source, globalModifier);
}

async function loadAttributedSignalFeedbackContext(
  pool: Pool,
  workspace_id: string,
  event: OutcomeRecordedEvent,
): Promise<AttributedSignalFeedbackContext | null> {
  const attributed_signal_id = event.payload.attributed_signal_id ?? null;
  if (!attributed_signal_id) return null;
  const { rows } = await pool.query<{
    signal_id: string;
    source: string | null;
    signal_kind: SignalKind;
  }>(
    `select s.id::text as signal_id,
            coalesce(gs.name, 'unknown') as source,
            s.kind::text as signal_kind
       from signals s
       left join graph_sources gs
         on gs.workspace_id = s.workspace_id
        and gs.id = s.source_id
      where s.workspace_id = $1
        and s.id = $2
      limit 1`,
    [workspace_id, attributed_signal_id],
  );
  const row = rows[0];
  if (!row?.signal_kind) return null;
  return {
    signal_id: row.signal_id,
    source: normalizeFeedbackSource(row.source) ?? "unknown",
    signal_kind: row.signal_kind,
  };
}

async function recomputeSignalFeedbackStats(
  pool: Pool,
  input: {
    workspace_id: string | null;
    source: string;
    signal_kind: SignalKind;
    last_event_id: string;
  },
): Promise<{ changed: boolean; stats: SignalFeedbackStatsRow }> {
  const counts = await loadSignalFeedbackCounts(pool, input.workspace_id, input.source, input.signal_kind);
  const learned_modifier = computeLearnedModifier(
    counts.positive_outcomes,
    counts.signals_surfaced,
  );
  const existing = await loadSignalFeedbackStatsRow(
    pool,
    input.workspace_id,
    input.source,
    input.signal_kind,
  );
  const stats = await upsertSignalFeedbackStats(pool, {
    workspace_id: input.workspace_id,
    source: input.source,
    signal_kind: input.signal_kind,
    positive_outcomes: counts.positive_outcomes,
    signals_surfaced: counts.signals_surfaced,
    learned_modifier,
    last_event_id: input.last_event_id,
  });
  return {
    changed: !existing ||
      existing.positive_outcomes !== stats.positive_outcomes ||
      existing.signals_surfaced !== stats.signals_surfaced ||
      existing.learned_modifier !== stats.learned_modifier,
    stats,
  };
}

async function loadSignalFeedbackCounts(
  pool: Pool,
  workspace_id: string | null,
  source: string,
  signal_kind: SignalKind,
): Promise<SignalFeedbackCountRow> {
  const { rows } = await pool.query<SignalFeedbackCountRow>(
    `with surfaced as (
       select count(*)::int as signals_surfaced
         from signals s
         left join graph_sources gs
           on gs.workspace_id = s.workspace_id
          and gs.id = s.source_id
        where s.kind = $2::signal_kind
          and coalesce(gs.name, 'unknown') = $1
          and ($3::uuid is null or s.workspace_id = $3)
     ),
     positives as (
       select count(*)::int as positive_outcomes
         from events e
         join signals s
           on s.workspace_id = e.workspace_id
          and s.id = nullif(e.payload->>'attributed_signal_id', '')::uuid
         left join graph_sources gs
           on gs.workspace_id = s.workspace_id
          and gs.id = s.source_id
        where e.event_type = 'outcome.recorded'
          and (e.payload->>'kind') = any($4::text[])
          and s.kind = $2::signal_kind
          and coalesce(gs.name, 'unknown') = $1
          and ($3::uuid is null or e.workspace_id = $3)
     )
     select coalesce(positives.positive_outcomes, 0) as positive_outcomes,
            coalesce(surfaced.signals_surfaced, 0) as signals_surfaced
       from positives
       cross join surfaced`,
    [source, signal_kind, workspace_id, [...POSITIVE_OUTCOME_KINDS]],
  );
  return {
    positive_outcomes: rows[0]?.positive_outcomes ?? 0,
    signals_surfaced: rows[0]?.signals_surfaced ?? 0,
  };
}

async function aggregateFeedbackStats(
  pool: Pool,
  input: {
    workspace_id: string | null;
    source?: string;
    signal_kind?: SignalKind;
  },
): Promise<SignalFeedbackAggregateRow> {
  const clauses = [
    input.workspace_id === null ? "workspace_id is null" : "workspace_id = $1",
  ];
  const values: Array<string | null> = [];
  let parameterIndex = 1;
  if (input.workspace_id !== null) {
    values.push(input.workspace_id);
    parameterIndex += 1;
  }
  if (input.source) {
    clauses.push(`source = $${parameterIndex}`);
    values.push(input.source);
    parameterIndex += 1;
  }
  if (input.signal_kind) {
    clauses.push(`signal_kind = $${parameterIndex}::signal_kind`);
    values.push(input.signal_kind);
  }
  const { rows } = await pool.query<SignalFeedbackAggregateRow>(
    `select count(*)::int as row_count,
            coalesce(sum(positive_outcomes), 0)::int as positive_outcomes,
            coalesce(sum(signals_surfaced), 0)::int as signals_surfaced
       from signal_feedback_stats
      where ${clauses.join(" and ")}`,
    values,
  );
  return rows[0] ?? {
    row_count: 0,
    positive_outcomes: 0,
    signals_surfaced: 0,
  };
}

async function loadScopedSourceModifier(
  pool: Pool,
  workspace_id: string | null,
  source: string,
): Promise<number> {
  const stats = await aggregateFeedbackStats(pool, {
    workspace_id,
    source,
  });
  return stats.row_count > 0
    ? computeLearnedModifier(stats.positive_outcomes, stats.signals_surfaced)
    : 1;
}

async function persistWorkspaceSourceModifier(
  pool: Pool,
  workspace_id: string,
  source: string,
  modifier: number,
): Promise<void> {
  await pool.query(
    `update graph_sources
        set properties = coalesce(properties, '{}'::jsonb) ||
          jsonb_build_object(
            'signal_feedback',
            coalesce(properties->'signal_feedback', '{}'::jsonb) ||
              jsonb_build_object('source_modifier', $3::double precision)
          )
      where workspace_id = $1
        and name = $2`,
    [workspace_id, source, modifier],
  );
}

async function persistGlobalSourceModifier(
  pool: Pool,
  source: string,
  modifier: number,
): Promise<void> {
  await pool.query(
    `update graph_sources
        set properties = coalesce(properties, '{}'::jsonb) ||
          jsonb_build_object(
            'signal_feedback',
            coalesce(properties->'signal_feedback', '{}'::jsonb) ||
              jsonb_build_object('global_source_modifier', $2::double precision)
          )
      where name = $1`,
    [source, modifier],
  );
}

async function loadSignalFeedbackStatsRow(
  pool: Pool,
  workspace_id: string | null,
  source: string,
  signal_kind: SignalKind,
): Promise<SignalFeedbackStatsRow | null> {
  const query = workspace_id === null
    ? `select workspace_id::text as workspace_id,
              source,
              signal_kind::text as signal_kind,
              positive_outcomes,
              signals_surfaced,
              learned_modifier,
              last_event_id::text as last_event_id,
              updated_at
         from signal_feedback_stats
        where workspace_id is null
          and source = $1
          and signal_kind = $2::signal_kind
        limit 1`
    : `select workspace_id::text as workspace_id,
              source,
              signal_kind::text as signal_kind,
              positive_outcomes,
              signals_surfaced,
              learned_modifier,
              last_event_id::text as last_event_id,
              updated_at
         from signal_feedback_stats
        where workspace_id = $1
          and source = $2
          and signal_kind = $3::signal_kind
        limit 1`;
  const values = workspace_id === null
    ? [source, signal_kind]
    : [workspace_id, source, signal_kind];
  const { rows } = await pool.query<{
    workspace_id: string | null;
    source: string;
    signal_kind: SignalKind;
    positive_outcomes: number;
    signals_surfaced: number;
    learned_modifier: number;
    last_event_id: string | null;
    updated_at: Date;
  }>(query, values);
  const row = rows[0];
  if (!row) return null;
  return {
    workspace_id: row.workspace_id,
    source: row.source,
    signal_kind: row.signal_kind,
    positive_outcomes: row.positive_outcomes,
    signals_surfaced: row.signals_surfaced,
    learned_modifier: roundModifier(row.learned_modifier),
    last_event_id: row.last_event_id ?? "",
    updated_at: row.updated_at.toISOString(),
  };
}

async function upsertSignalFeedbackStats(
  pool: Pool,
  row: SignalFeedbackStatsUpsertRow,
): Promise<SignalFeedbackStatsRow> {
  const query = row.workspace_id === null
    ? `insert into signal_feedback_stats (
         workspace_id,
         source,
         signal_kind,
         positive_outcomes,
         signals_surfaced,
         learned_modifier,
         last_event_id,
         updated_at
       ) values (
         null,
         $1,
         $2::signal_kind,
         $3,
         $4,
         $5,
         $6,
         now()
       )
       on conflict (source, signal_kind) where workspace_id is null
       do update set
         positive_outcomes = excluded.positive_outcomes,
         signals_surfaced = excluded.signals_surfaced,
         learned_modifier = excluded.learned_modifier,
         last_event_id = excluded.last_event_id,
         updated_at = now()
       returning workspace_id::text as workspace_id,
                 source,
                 signal_kind::text as signal_kind,
                 positive_outcomes,
                 signals_surfaced,
                 learned_modifier,
                 last_event_id::text as last_event_id,
                 updated_at`
    : `insert into signal_feedback_stats (
         workspace_id,
         source,
         signal_kind,
         positive_outcomes,
         signals_surfaced,
         learned_modifier,
         last_event_id,
         updated_at
       ) values (
         $1,
         $2,
         $3::signal_kind,
         $4,
         $5,
         $6,
         $7,
         now()
       )
       on conflict (workspace_id, source, signal_kind) where workspace_id is not null
       do update set
         positive_outcomes = excluded.positive_outcomes,
         signals_surfaced = excluded.signals_surfaced,
         learned_modifier = excluded.learned_modifier,
         last_event_id = excluded.last_event_id,
         updated_at = now()
       returning workspace_id::text as workspace_id,
                 source,
                 signal_kind::text as signal_kind,
                 positive_outcomes,
                 signals_surfaced,
                 learned_modifier,
                 last_event_id::text as last_event_id,
                 updated_at`;
  const values = row.workspace_id === null
    ? [
        row.source,
        row.signal_kind,
        row.positive_outcomes,
        row.signals_surfaced,
        row.learned_modifier,
        row.last_event_id,
      ]
    : [
        row.workspace_id,
        row.source,
        row.signal_kind,
        row.positive_outcomes,
        row.signals_surfaced,
        row.learned_modifier,
        row.last_event_id,
      ];
  const { rows } = await pool.query<{
    workspace_id: string | null;
    source: string;
    signal_kind: SignalKind;
    positive_outcomes: number;
    signals_surfaced: number;
    learned_modifier: number;
    last_event_id: string | null;
    updated_at: Date;
  }>(query, values);
  const updated = rows[0]!;
  return {
    workspace_id: updated.workspace_id,
    source: updated.source,
    signal_kind: updated.signal_kind,
    positive_outcomes: updated.positive_outcomes,
    signals_surfaced: updated.signals_surfaced,
    learned_modifier: roundModifier(updated.learned_modifier),
    last_event_id: updated.last_event_id ?? "",
    updated_at: updated.updated_at.toISOString(),
  };
}

function normalizeFeedbackSource(source: string | null | undefined): string | null {
  if (typeof source !== "string") return null;
  const trimmed = source.trim();
  return trimmed ? trimmed : null;
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function clampBetween(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundModifier(value: number): number {
  return Number(value.toFixed(4));
}
