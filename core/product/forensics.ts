import type { Pool } from "pg";

export interface EventTraceEvent {
  id: string;
  event_type: string;
  correlation_id: string | null;
  causation_id: string | null;
  source: string;
  producer_ref: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  depth: number;
}

export interface EventTraceSummary {
  correlation_id: string | null;
  event_count: number;
  started_at: string | null;
  ended_at: string | null;
  root_event_type: string | null;
  terminal_event_type: string | null;
  contains_failure: boolean;
}

export interface EventTrace {
  summary: EventTraceSummary;
  events: EventTraceEvent[];
}

interface EventTraceRow {
  id: string;
  event_type: string;
  correlation_id: string | null;
  causation_id: string | null;
  source: string;
  producer_ref: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
  depth: number | null;
}

export function summarizeEventTrace(
  events: EventTraceEvent[],
  correlation_id: string | null,
): EventTraceSummary {
  const first = events[0] ?? null;
  const last = events.at(-1) ?? null;
  return {
    correlation_id,
    event_count: events.length,
    started_at: first?.occurred_at ?? null,
    ended_at: last?.occurred_at ?? null,
    root_event_type: first?.event_type ?? null,
    terminal_event_type: last?.event_type ?? null,
    contains_failure: events.some(
      (event) =>
        event.event_type.endsWith(".failed") ||
        event.event_type === "message.bounced" ||
        event.event_type === "message.deferred",
    ),
  };
}

export async function getEventTraceForCorrelation(
  pool: Pool,
  opts: {
    workspace_id: string;
    correlation_id: string;
    limit?: number;
  },
): Promise<EventTrace> {
  const limit = opts.limit ?? 100;
  const { rows } = await pool.query<EventTraceRow>(
    `with recursive causal_tree as (
       select e.id, 0 as depth
         from events e
        where e.workspace_id = $1
          and (e.id = $2::uuid or e.correlation_id = $2::uuid)
          and e.causation_id is null
       union all
       select child.id, causal_tree.depth + 1
         from events child
         join causal_tree
           on child.causation_id = causal_tree.id
        where child.workspace_id = $1
     ),
     scoped as (
       select e.id,
              e.event_type,
              e.correlation_id,
              e.causation_id,
              e.source,
              e.producer_ref,
              e.idempotency_key,
              e.payload,
              e.occurred_at,
              min(causal_tree.depth) as depth
         from events e
         left join causal_tree
           on causal_tree.id = e.id
        where e.workspace_id = $1
          and (
            e.id = $2::uuid
            or e.correlation_id = $2::uuid
            or causal_tree.id is not null
          )
        group by e.id
     )
     select id,
            event_type,
            correlation_id,
            causation_id,
            source,
            producer_ref,
            idempotency_key,
            payload,
            occurred_at,
            depth
       from scoped
      order by occurred_at asc, id asc
      limit $3`,
    [opts.workspace_id, opts.correlation_id, limit],
  );
  return formatTraceRows(rows, opts.correlation_id);
}

export async function getLatestEventTraceForWorkspace(
  pool: Pool,
  opts: {
    workspace_id: string;
    limit?: number;
  },
): Promise<EventTrace> {
  const latest = await pool.query<{ trace_id: string }>(
    `select coalesce(correlation_id, id) as trace_id
       from events
      where workspace_id = $1
      order by occurred_at desc, id desc
      limit 1`,
    [opts.workspace_id],
  );
  const trace_id = latest.rows[0]?.trace_id;
  if (!trace_id) return formatTraceRows([], null);
  return getEventTraceForCorrelation(pool, {
    workspace_id: opts.workspace_id,
    correlation_id: trace_id,
    limit: opts.limit,
  });
}

function formatTraceRows(
  rows: EventTraceRow[],
  correlation_id: string | null,
): EventTrace {
  const events = rows.map((row) => ({
    id: row.id,
    event_type: row.event_type,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    source: row.source,
    producer_ref: row.producer_ref,
    idempotency_key: row.idempotency_key,
    payload: row.payload,
    occurred_at: row.occurred_at.toISOString(),
    depth: row.depth ?? 0,
  }));
  return {
    summary: summarizeEventTrace(events, correlation_id),
    events,
  };
}
