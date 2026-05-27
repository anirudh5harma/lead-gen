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
 */
export interface JournaledNatsEventBusOptions extends NatsEventBusOptions {
  pool: Pool;
}

export interface DispatchRedriveResult {
  attempted: number;
  delivered: number;
  failed: number;
}

export interface JournaledNatsEventBus extends NatsEventBus {
  redrivePending(limit?: number): Promise<DispatchRedriveResult>;
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

export async function createJournaledNatsEventBus(
  opts: JournaledNatsEventBusOptions,
): Promise<JournaledNatsEventBus> {
  const { pool, ...natsOptions } = opts;
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
      await pool
        .query(
          `update event_nats_dispatches
              set attempts = attempts + 1,
                  last_error = $2,
                  next_attempt_at = now() + interval '5 seconds',
                  updated_at = now()
            where event_id = $1
              and status = 'pending'`,
          [event.id, err instanceof Error ? err.message : String(err)],
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
    };
    for (const row of rows) {
      try {
        await deliverAndRecord(toPublishedEvent(row));
        result.delivered++;
      } catch {
        result.failed++;
      }
    }
    return result;
  }

  return {
    ...delivery,
    publish: publish as EventBus["publish"],
    redrivePending,
  };
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
