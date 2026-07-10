import type { Pool } from "pg";
import type { EventBus } from "../bus.ts";
import type { EventInput, PublishedEvent } from "../types.ts";
import {
  createNatsEventBus,
  type NatsEventBus,
  type NatsEventBusOptions,
} from "./nats.ts";
import { appendPostgresEvent } from "./postgres.ts";

/**
 * Production event bus composition.
 *
 * Postgres is the canonical append-only event journal presently consumed by
 * hot-path gating and audit queries. A transactional dispatch row records
 * that its identical canonical event must be delivered to NATS JetStream.
 * Failed or interrupted delivery can then be safely redriven by event ID.
 *
 * Failure handling: each delivery attempt increments `attempts`. Past
 * `maxAttempts` (default 8) the dispatch flips to `dead_lettered` and is
 * no longer picked up by `redrivePending`. Operators inspect dead-letter
 * rows via the dashboard and redrive them deliberately with
 * `redriveDeadLettered(event_id)` once the upstream issue is fixed.
 */
export interface JournaledNatsEventBusOptions extends NatsEventBusOptions {
  pool: Pool;
  /** Defaults to 8 — exhausted dispatches flip to status='dead_lettered'. */
  maxAttempts?: number;
}

export interface DispatchRedriveResult {
  attempted: number;
  delivered: number;
  failed: number;
  dead_lettered: number;
}

export interface DeadLetteredDispatch {
  event_id: string;
  workspace_id: string;
  event_type: string;
  attempts: number;
  last_error: string | null;
  dead_lettered_at: string;
  source: string;
  producer_ref: string | null;
}

export interface JournaledNatsEventBus extends NatsEventBus {
  redrivePending(limit?: number): Promise<DispatchRedriveResult>;
  redriveDeadLettered(event_id: string): Promise<boolean>;
  recoverTransientDeadLetters(limit?: number): Promise<number>;
}

interface DispatchRow {
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

const TRANSIENT_DEAD_LETTER_ERRORS = ["CONNECTION_CLOSED", "TIMEOUT"] as const;

export async function createJournaledNatsEventBus(
  opts: JournaledNatsEventBusOptions,
): Promise<JournaledNatsEventBus> {
  const { pool, maxAttempts: maxAttemptsOpt, ...natsOptions } = opts;
  const maxAttempts = Math.max(1, Math.trunc(maxAttemptsOpt ?? 8));
  const delivery = await createNatsEventBus(natsOptions);
  const deliver = delivery.publish as (
    input: EventInput,
  ) => Promise<PublishedEvent>;

  async function publish(input: EventInput): Promise<PublishedEvent> {
    const client = await pool.connect();
    let canonical: PublishedEvent;
    let alreadyDelivered = false;
    try {
      await client.query("begin");
      canonical = await appendPostgresEvent(client, input);
      await client.query(
        `insert into event_nats_dispatches (event_id, workspace_id)
         values ($1, $2)
         on conflict (event_id) do nothing`,
        [canonical.id, canonical.workspace_id],
      );
      const result = await client.query<{ status: string }>(
        `select status from event_nats_dispatches where event_id = $1`,
        [canonical.id],
      );
      alreadyDelivered = result.rows[0]?.status === "delivered";
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    if (!alreadyDelivered) {
      await deliverAndRecord(canonical!);
    }
    return canonical!;
  }

  async function deliverAndRecord(event: PublishedEvent): Promise<void> {
    try {
      await deliver(event);
      await pool.query(
        `update event_nats_dispatches
            set status = 'delivered',
                attempts = attempts + 1,
                last_error = null,
                delivered_at = now(),
                updated_at = now()
          where event_id = $1`,
        [event.id],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Bump attempts; if we've now exhausted, flip to dead_lettered so
      // it stops being redriven automatically and surfaces in the
      // operator dashboard. Otherwise back off + remain pending.
      await pool
        .query(
          `update event_nats_dispatches
              set attempts        = attempts + 1,
                  last_error      = $2,
                  status          = case
                                      when status = 'pending'
                                       and attempts + 1 >= $3
                                      then 'dead_lettered'
                                      else status
                                    end,
                  dead_lettered_at = case
                                       when status = 'pending'
                                        and attempts + 1 >= $3
                                       then now()
                                       else dead_lettered_at
                                     end,
                  next_attempt_at = case
                                      when status = 'pending'
                                       and attempts + 1 < $3
                                      then now() + interval '5 seconds'
                                      else next_attempt_at
                                    end,
                  updated_at      = now()
            where event_id = $1
              and status in ('pending')`,
          [event.id, message, maxAttempts],
        )
        .catch(() => undefined);
      throw err;
    }
  }

  async function redrivePending(limit = 100): Promise<DispatchRedriveResult> {
    const boundedLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const { rows } = await pool.query<DispatchRow>(
      `select d.event_id, e.workspace_id, e.event_type, e.schema_version,
              e.correlation_id, e.causation_id, e.source, e.producer_ref,
              e.idempotency_key, e.payload, e.occurred_at
         from event_nats_dispatches d
         join events e on e.id = d.event_id
        where d.status = 'pending'
          and d.next_attempt_at <= now()
        order by d.created_at asc
        limit $1`,
      [boundedLimit],
    );
    const result: DispatchRedriveResult = {
      attempted: rows.length,
      delivered: 0,
      failed: 0,
      dead_lettered: 0,
    };
    for (const row of rows) {
      try {
        await deliverAndRecord(toPublishedEvent(row));
        result.delivered++;
      } catch {
        // Re-read status to see if this attempt flipped the dispatch to
        // dead_lettered (rather than just failing one more attempt).
        const status = await pool
          .query<{ status: string }>(
            `select status from event_nats_dispatches where event_id = $1`,
            [row.event_id],
          )
          .then((r) => r.rows[0]?.status ?? "unknown");
        if (status === "dead_lettered") result.dead_lettered++;
        else result.failed++;
      }
    }
    return result;
  }

  async function redriveDeadLettered(event_id: string): Promise<boolean> {
    return redriveDeadLetteredDispatch(pool, event_id);
  }

  async function recoverTransientDeadLetters(limit = 100): Promise<number> {
    return recoverTransientDeadLetterDispatches(pool, { limit });
  }

  return {
    ...delivery,
    publish: publish as EventBus["publish"],
    redrivePending,
    redriveDeadLettered,
    recoverTransientDeadLetters,
  };
}

/**
 * Operator-initiated replay of a dead-lettered dispatch. Resets the
 * dispatch back to 'pending' with a fresh next_attempt_at so the next
 * redrivePending call picks it up. Returns true if the row was reset.
 */
export async function redriveDeadLetteredDispatch(
  pool: Pool,
  event_id: string,
  opts: { workspace_id?: string } = {},
): Promise<boolean> {
  const result = await pool.query(
    `update event_nats_dispatches
        set status           = 'pending',
            next_attempt_at  = now(),
            dead_lettered_at = null,
            updated_at       = now()
      where event_id = $1
        and status   = 'dead_lettered'
        and ($2::uuid is null or workspace_id = $2)`,
    [event_id, opts.workspace_id ?? null],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function recoverTransientDeadLetterDispatches(
  pool: Pool,
  opts: { limit?: number; workspace_id?: string } = {},
): Promise<number> {
  const bounded = Math.max(1, Math.min(1000, Math.trunc(opts.limit ?? 100)));
  const { rowCount } = await pool.query(
    `with candidates as (
       select d.event_id
         from event_nats_dispatches d
        where d.status = 'dead_lettered'
          and ($2::uuid is null or d.workspace_id = $2)
          and d.last_error = any($3::text[])
        order by d.dead_lettered_at asc nulls first, d.created_at asc
        limit $1
        for update skip locked
     )
     update event_nats_dispatches d
        set status = 'pending',
            attempts = 0,
            next_attempt_at = now(),
            last_error = null,
            dead_lettered_at = null,
            updated_at = now()
       from candidates c
      where d.event_id = c.event_id`,
    [bounded, opts.workspace_id ?? null, [...TRANSIENT_DEAD_LETTER_ERRORS]],
  );
  return rowCount ?? 0;
}

/**
 * Operator query: list dead-lettered dispatches for a workspace. Independent
 * of the bus instance; the dashboard calls this directly off the pool.
 */
export async function listDeadLetteredDispatches(
  pool: Pool,
  workspace_id: string,
  limit = 50,
): Promise<DeadLetteredDispatch[]> {
  const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
  const { rows } = await pool.query<{
    event_id: string;
    workspace_id: string;
    event_type: string;
    attempts: number;
    last_error: string | null;
    dead_lettered_at: Date;
    source: string;
    producer_ref: string | null;
  }>(
    `select d.event_id, d.workspace_id, e.event_type,
            d.attempts, d.last_error, d.dead_lettered_at,
            e.source, e.producer_ref
       from event_nats_dispatches d
       join events e on e.id = d.event_id
      where d.workspace_id = $1
        and d.status       = 'dead_lettered'
      order by d.dead_lettered_at desc
      limit $2`,
    [workspace_id, bounded],
  );
  return rows.map((r) => ({
    event_id: r.event_id,
    workspace_id: r.workspace_id,
    event_type: r.event_type,
    attempts: r.attempts,
    last_error: r.last_error,
    dead_lettered_at: r.dead_lettered_at instanceof Date
      ? r.dead_lettered_at.toISOString()
      : String(r.dead_lettered_at),
    source: r.source,
    producer_ref: r.producer_ref,
  }));
}

function toPublishedEvent(row: DispatchRow): PublishedEvent {
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
