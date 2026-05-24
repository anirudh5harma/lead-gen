import pg from "pg";
import type { Pool } from "pg";
import type { EventBus } from "../bus.ts";
import { eventRegistry, isKnownEventType } from "../registry.ts";
import type {
  EventHandler,
  EventInput,
  PublishedEvent,
  Subscription,
} from "../types.ts";

/**
 * Postgres-backed event bus. The durable backbone for production.
 *
 *   publish()  → validates against the registry, INSERTs into `events`.
 *                  The trigger from migration 013 fires NOTIFY 'events' with
 *                  the new row's id + workspace_id + event_type.
 *
 *   subscribe() → holds a dedicated LISTEN client. On each NOTIFY, parses
 *                  the routing JSON; if the event_type matches a typed
 *                  subscriber (or '*'), SELECTs the row and dispatches.
 *
 * Routing payloads stay tiny (<8KB NOTIFY cap is never approached). Full
 * payloads come back from the SELECT.
 *
 * Workspace scope is per-subscription: pass `workspaceId` to receive only
 * that workspace's events. Omit it to receive all (system / admin use).
 *
 * Reconnection: the LISTEN client uses `pg.Client` directly (not from the
 * pool) so it can hold the connection indefinitely. On error or disconnect
 * it logs and gives up — production deployments should wrap this with a
 * supervisor (forever-loop, exponential backoff) until we land that here.
 */

export interface PostgresEventBusOptions {
  /** Pool used for publish() and the per-notification SELECT. */
  pool: Pool;
  /** If set, only events for this workspace are dispatched. */
  workspaceId?: string;
  /** Optional connection string for the dedicated LISTEN client; defaults to the pool's. */
  listenConnectionString?: string;
  /** Logger hook. Defaults to console.error. */
  onError?: (err: unknown) => void;
}

export interface PostgresEventBus extends EventBus {
  /** Close the LISTEN client. After this, subscribers stop receiving events. */
  close(): Promise<void>;
}

interface NotifyPayload {
  id: string;
  workspace_id: string;
  event_type: string;
}

export async function createPostgresEventBus(
  opts: PostgresEventBusOptions,
): Promise<PostgresEventBus> {
  const onError = opts.onError ?? ((err) => console.error("[pg-event-bus]", err));
  const subscribers = new Map<string, Set<EventHandler>>();
  const wildcard = new Set<EventHandler>();

  // Dedicated LISTEN client. Long-lived; can't come from the pool because
  // we never release it.
  const listenClient = new pg.Client(
    opts.listenConnectionString
      ? { connectionString: opts.listenConnectionString }
      : { connectionString: process.env.DATABASE_URL },
  );
  await listenClient.connect();

  listenClient.on("error", (err) => {
    onError(new Error(`LISTEN client error: ${err.message}`));
  });

  listenClient.on("notification", (msg) => {
    if (msg.channel !== "events" || !msg.payload) return;
    let routing: NotifyPayload;
    try {
      routing = JSON.parse(msg.payload) as NotifyPayload;
    } catch {
      onError(new Error(`malformed notify payload: ${msg.payload}`));
      return;
    }
    if (opts.workspaceId && routing.workspace_id !== opts.workspaceId) return;

    const typed = subscribers.get(routing.event_type);
    if (!typed?.size && !wildcard.size) return;

    // Async dispatch — fetch the full event and fan out to handlers.
    void dispatchById(routing.id).catch((err) => onError(err));
  });

  await listenClient.query("listen events");

  async function dispatchById(id: string): Promise<void> {
    const { rows } = await opts.pool.query<PostgresEventRow>(
      `select id, workspace_id, event_type, schema_version,
              correlation_id, causation_id, source, producer_ref,
              payload, occurred_at
         from events
        where id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return;
    const event: PublishedEvent = {
      id: row.id,
      workspace_id: row.workspace_id,
      event_type: row.event_type,
      schema_version: row.schema_version,
      correlation_id: row.correlation_id,
      causation_id: row.causation_id,
      source: row.source as PublishedEvent["source"],
      producer_ref: row.producer_ref,
      payload: row.payload,
      occurred_at:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : row.occurred_at,
    };

    const typed = subscribers.get(event.event_type);
    if (typed) {
      for (const h of typed) safeCall(h, event, onError);
    }
    for (const h of wildcard) safeCall(h, event, onError);
  }

  async function publish(input: EventInput): Promise<PublishedEvent> {
    if (!isKnownEventType(input.event_type)) {
      throw new Error(`Unknown event_type: ${input.event_type}`);
    }
    const parsed = eventRegistry[input.event_type].parse(input.payload);

    const { rows } = await opts.pool.query<{
      id: string;
      occurred_at: Date | string;
    }>(
      `insert into events (
         id, workspace_id, event_type, schema_version,
         correlation_id, causation_id, source, producer_ref,
         payload, occurred_at
       ) values (
         coalesce($1, gen_random_uuid()), $2, $3, $4,
         $5, $6, $7, $8,
         $9, coalesce($10::timestamptz, now())
       )
       returning id, occurred_at`,
      [
        input.id ?? null,
        input.workspace_id,
        input.event_type,
        input.schema_version ?? 1,
        input.correlation_id ?? null,
        input.causation_id ?? null,
        input.source,
        input.producer_ref ?? null,
        parsed,
        input.occurred_at ?? null,
      ],
    );
    const row = rows[0]!;
    return {
      id: row.id,
      workspace_id: input.workspace_id,
      event_type: input.event_type,
      schema_version: input.schema_version ?? 1,
      correlation_id: input.correlation_id ?? null,
      causation_id: input.causation_id ?? null,
      source: input.source,
      producer_ref: input.producer_ref ?? null,
      payload: parsed,
      occurred_at:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : row.occurred_at,
    };
  }

  async function subscribe(
    event_type: string,
    handler: EventHandler,
  ): Promise<Subscription> {
    if (event_type === "*") {
      wildcard.add(handler);
      return {
        unsubscribe: async () => {
          wildcard.delete(handler);
        },
      };
    }
    if (!isKnownEventType(event_type)) {
      throw new Error(`Unknown event_type: ${event_type}`);
    }
    let set = subscribers.get(event_type);
    if (!set) {
      set = new Set();
      subscribers.set(event_type, set);
    }
    set.add(handler);
    return {
      unsubscribe: async () => {
        set!.delete(handler);
      },
    };
  }

  return {
    publish: publish as EventBus["publish"],
    subscribe: subscribe as EventBus["subscribe"],
    async close() {
      try {
        await listenClient.query("unlisten events");
      } catch {
        /* ignore */
      }
      await listenClient.end();
    },
  };
}

function safeCall(
  handler: EventHandler,
  event: PublishedEvent,
  onError: (err: unknown) => void,
): void {
  try {
    const r = handler(event);
    if (r instanceof Promise) r.catch((err) => onError(err));
  } catch (err) {
    onError(err);
  }
}

interface PostgresEventRow {
  id: string;
  workspace_id: string;
  event_type: string;
  schema_version: number;
  correlation_id: string | null;
  causation_id: string | null;
  source: string;
  producer_ref: string | null;
  payload: unknown;
  occurred_at: Date | string;
}
