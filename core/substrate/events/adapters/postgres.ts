import pg from "pg";
import type { Pool, PoolClient } from "pg";
import type { EventBus } from "../bus.ts";
import { eventRegistry, isKnownEventType } from "../registry.ts";
import type {
  EventHandler,
  EventInput,
  PublishedEvent,
  Subscription,
} from "../types.ts";

/**
 * Postgres-backed event bus. A local/development bridge while production
 * deploys NATS JetStream as required by ARCHITECTURE.md.
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
 * pool) so it can hold the connection indefinitely. On error or disconnect,
 * the bus reconnects with bounded exponential backoff. Durable projections
 * still catch up mutations emitted during an outage.
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
  /** Initial delay before replacing a disconnected LISTEN client. */
  reconnectBaseMs?: number;
  /** Maximum delay between LISTEN reconnection attempts. */
  reconnectMaxMs?: number;
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

/**
 * Append one canonical event to the durable journal. Production delivery
 * adapters use this function before dispatch so gating, replay, and audit
 * observe the same event identity that consumers receive.
 */
export async function appendPostgresEvent(
  pool: Pool | PoolClient,
  input: EventInput,
): Promise<PublishedEvent> {
  if (!isKnownEventType(input.event_type)) {
    throw new Error(`Unknown event_type: ${input.event_type}`);
  }
  const parsed = eventRegistry[input.event_type].parse(input.payload);

  const { rows } = await pool.query<PostgresEventRow>(
    `with inserted as (
     insert into events (
       id, workspace_id, event_type, schema_version,
       correlation_id, causation_id, source, producer_ref,
       idempotency_key, payload, occurred_at
     ) values (
       coalesce($1, gen_random_uuid()), $2, $3, $4,
       $5, $6, $7, $8,
       $9, $10, coalesce($11::timestamptz, now())
     )
     on conflict (workspace_id, event_type, idempotency_key)
       where idempotency_key is not null
     do nothing
     returning id, workspace_id, event_type, schema_version,
               correlation_id, causation_id, source, producer_ref,
               idempotency_key, payload, occurred_at
     )
     select * from inserted
     union all
     select id, workspace_id, event_type, schema_version,
            correlation_id, causation_id, source, producer_ref,
            idempotency_key, payload, occurred_at
       from events
      where $9::text is not null
        and workspace_id = $2
        and event_type = $3
        and idempotency_key = $9
        and not exists (select 1 from inserted)
      limit 1`,
    [
      input.id ?? null,
      input.workspace_id,
      input.event_type,
      input.schema_version ?? 1,
      input.correlation_id ?? null,
      input.causation_id ?? null,
      input.source,
      input.producer_ref ?? null,
      input.idempotency_key ?? null,
      parsed,
      input.occurred_at ?? null,
    ],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    event_type: row.event_type,
    schema_version: row.schema_version,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    source: row.source as PublishedEvent["source"],
    producer_ref: row.producer_ref,
    idempotency_key: row.idempotency_key,
    payload: row.payload as typeof parsed,
    occurred_at:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : row.occurred_at,
  };
}

export async function createPostgresEventBus(
  opts: PostgresEventBusOptions,
): Promise<PostgresEventBus> {
  const onError = opts.onError ?? ((err) => console.error("[pg-event-bus]", err));
  const subscribers = new Map<string, Set<EventHandler>>();
  const wildcard = new Set<EventHandler>();
  const reconnectBaseMs = Math.max(10, Math.trunc(opts.reconnectBaseMs ?? 250));
  const reconnectMaxMs = Math.max(
    reconnectBaseMs,
    Math.trunc(opts.reconnectMaxMs ?? 30_000),
  );
  let closed = false;
  let retryAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnecting: Promise<void> | null = null;
  let listenClient: pg.Client | null = null;
  const localDispatchIds: string[] = [];
  const locallyDispatched = new Set<string>();

  function rememberLocalDispatch(id: string): void {
    locallyDispatched.add(id);
    localDispatchIds.push(id);
    while (localDispatchIds.length > 1000) {
      const oldest = localDispatchIds.shift();
      if (oldest) locallyDispatched.delete(oldest);
    }
  }

  function dispatchEvent(event: PublishedEvent): void {
    const typed = subscribers.get(event.event_type);
    if (typed) {
      for (const h of typed) safeCall(h, event, onError);
    }
    for (const h of wildcard) safeCall(h, event, onError);
  }

  function handleNotification(msg: pg.Notification): void {
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
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    if (reconnecting) {
      void reconnecting.finally(() => scheduleReconnect());
      return;
    }
    const delayMs = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** retryAttempt);
    retryAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnecting = reconnect().finally(() => {
        reconnecting = null;
      });
    }, delayMs);
    reconnectTimer.unref?.();
  }

  function handleDisconnect(client: pg.Client, err?: Error): void {
    if (closed || client !== listenClient) return;
    listenClient = null;
    if (err) onError(new Error(`LISTEN client error: ${err.message}`));
    void client.end().catch(() => undefined);
    scheduleReconnect();
  }

  async function openListener(): Promise<pg.Client> {
    const client = new pg.Client(
      opts.listenConnectionString
        ? { connectionString: opts.listenConnectionString }
        : { connectionString: process.env.DATABASE_URL },
    );
    client.on("notification", handleNotification);
    client.on("error", (err) => {
      if (client === listenClient) {
        handleDisconnect(client, err);
      } else if (!closed) {
        onError(new Error(`LISTEN client error: ${err.message}`));
      }
    });
    client.on("end", () => handleDisconnect(client));
    try {
      await client.connect();
      await client.query("listen events");
      return client;
    } catch (err) {
      await client.end().catch(() => undefined);
      throw err;
    }
  }

  async function reconnect(): Promise<void> {
    if (closed) return;
    try {
      const client = await openListener();
      if (closed) {
        await client.end();
        return;
      }
      listenClient = client;
      retryAttempt = 0;
    } catch (err) {
      onError(new Error(`LISTEN reconnect failed: ${String(err)}`));
      scheduleReconnect();
    }
  }

  // Dedicated LISTEN client. Long-lived; can't come from the pool because
  // we never release it.
  listenClient = await openListener();

  async function dispatchById(id: string): Promise<void> {
    if (locallyDispatched.has(id)) return;
    const { rows } = await opts.pool.query<PostgresEventRow>(
      `select id, workspace_id, event_type, schema_version,
              correlation_id, causation_id, source, producer_ref,
              idempotency_key,
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
      idempotency_key: row.idempotency_key,
      payload: row.payload,
      occurred_at:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : row.occurred_at,
    };

    dispatchEvent(event);
  }

  async function publish(input: EventInput): Promise<PublishedEvent> {
    const event = await appendPostgresEvent(opts.pool, input);
    if (
      (!opts.workspaceId || opts.workspaceId === event.workspace_id) &&
      !locallyDispatched.has(event.id)
    ) {
      rememberLocalDispatch(event.id);
      dispatchEvent(event);
    }
    return event;
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
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const active = listenClient;
      listenClient = null;
      if (active) {
        try {
          await active.query("unlisten events");
        } catch {
          /* ignore */
        }
        await active.end().catch(() => undefined);
      }
      await reconnecting?.catch(() => undefined);
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
  idempotency_key: string | null;
  payload: unknown;
  occurred_at: Date | string;
}
