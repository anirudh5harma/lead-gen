import type { Pool } from "pg";
import type { PublishedEvent } from "./types.ts";

export interface DurableEventProjection {
  /** Stable versioned name. Change it intentionally to rebuild from history. */
  name: string;
  eventTypes: readonly string[];
  /**
   * Projectors may replay after a process dies between applying state and
   * acknowledging completion. This function must therefore be idempotent.
   */
  apply(event: PublishedEvent): Promise<void>;
}

export interface DurableProjectionRunOptions {
  leaseOwner: string;
  limit?: number;
  leaseMs?: number;
  retryBaseMs?: number;
  onError?: (err: unknown, projection: string, eventId: string) => void;
}

export interface DurableProjectionTick {
  seeded: number;
  claimed: number;
  completed: number;
  failed: number;
}

interface ProjectionJobEventRow {
  event_id: string;
  workspace_id: string;
  event_type: string;
  schema_version: number;
  correlation_id: string | null;
  causation_id: string | null;
  source: string;
  producer_ref: string | null;
  idempotency_key: string | null;
  payload: unknown;
  occurred_at: Date | string;
}

function toEvent(row: ProjectionJobEventRow): PublishedEvent {
  return {
    id: row.event_id,
    workspace_id: row.workspace_id,
    event_type: row.event_type,
    schema_version: row.schema_version,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    source: row.source as PublishedEvent["source"],
    producer_ref: row.producer_ref,
    idempotency_key: row.idempotency_key,
    payload: row.payload,
    occurred_at:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : row.occurred_at,
  };
}

export async function runDurableEventProjectionsOnce(
  pool: Pool,
  projections: readonly DurableEventProjection[],
  opts: DurableProjectionRunOptions,
): Promise<DurableProjectionTick> {
  const limit = Math.max(1, Math.trunc(opts.limit ?? 25));
  const leaseMs = Math.max(1000, Math.trunc(opts.leaseMs ?? 2 * 60 * 1000));
  const retryBaseMs = Math.max(1000, Math.trunc(opts.retryBaseMs ?? 1000));
  const tick: DurableProjectionTick = {
    seeded: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
  };

  for (const projection of projections) {
    if (projection.eventTypes.length === 0) continue;
    const seeded = await pool.query(
      `insert into event_projection_jobs (
         projection_name, event_id, workspace_id, event_type
       )
       select $1, e.id, e.workspace_id, e.event_type
         from events e
        where e.event_type = any($2::text[])
          and not exists (
            select 1
              from event_projection_jobs epj
             where epj.projection_name = $1
               and epj.event_id = e.id
          )
        order by e.occurred_at asc, e.id asc
        limit $3
       on conflict (projection_name, event_id) do nothing`,
      [projection.name, [...projection.eventTypes], limit],
    );
    tick.seeded += seeded.rowCount ?? 0;

    const { rows } = await pool.query<ProjectionJobEventRow>(
      `with candidates as (
         select epj.projection_name, epj.event_id
           from event_projection_jobs epj
           join events e on e.id = epj.event_id
          where epj.projection_name = $1
            and epj.next_attempt_at <= now()
            and (
              epj.status in ('pending', 'failed')
              or (epj.status = 'running' and epj.lease_expires_at < now())
            )
          order by e.occurred_at asc, e.id asc
          limit $2
          for update of epj skip locked
       ),
       claimed as (
         update event_projection_jobs epj
            set status = 'running',
                attempt_count = epj.attempt_count + 1,
                lease_owner = $3,
                lease_expires_at = now() + ($4::int * interval '1 millisecond'),
                updated_at = now()
           from candidates c
          where epj.projection_name = c.projection_name
            and epj.event_id = c.event_id
         returning epj.event_id
       )
       select e.id as event_id,
              e.workspace_id,
              e.event_type,
              e.schema_version,
              e.correlation_id,
              e.causation_id,
              e.source,
              e.producer_ref,
              e.idempotency_key,
              e.payload,
              e.occurred_at
         from claimed c
         join events e on e.id = c.event_id
        order by e.occurred_at asc, e.id asc`,
      [projection.name, limit, opts.leaseOwner, leaseMs],
    );
    tick.claimed += rows.length;

    for (const row of rows) {
      const event = toEvent(row);
      try {
        await projection.apply(event);
        await pool.query(
          `update event_projection_jobs
              set status = 'completed',
                  completed_at = now(),
                  lease_owner = null,
                  lease_expires_at = null,
                  last_error = null,
                  updated_at = now()
            where projection_name = $1
              and event_id = $2
              and lease_owner = $3`,
          [projection.name, event.id, opts.leaseOwner],
        );
        tick.completed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await pool.query(
          `update event_projection_jobs
              set status = 'failed',
                  next_attempt_at = now() + (
                    least(60000, $4::int * power(2, greatest(attempt_count - 1, 0))) *
                    interval '1 millisecond'
                  ),
                  lease_owner = null,
                  lease_expires_at = null,
                  last_error = $5::jsonb,
                  updated_at = now()
            where projection_name = $1
              and event_id = $2
              and lease_owner = $3`,
          [
            projection.name,
            event.id,
            opts.leaseOwner,
            retryBaseMs,
            JSON.stringify({ message }),
          ],
        );
        tick.failed++;
        opts.onError?.(err, projection.name, event.id);
      }
    }
  }

  return tick;
}
