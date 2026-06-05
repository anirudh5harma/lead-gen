import type { Pool } from "pg";
import type { EventBus } from "../bus.ts";
import type {
  EventHandler,
  EventInput,
  PublishedEvent,
  Subscription,
} from "../types.ts";
import {
  appendPostgresEvent,
  createPostgresEventBus,
  type PostgresEventBus,
} from "./postgres.ts";

/**
 * Web-safe production ingress bus.
 *
 * App routes and server actions should never synchronously dial NATS: a broker
 * outage or connection-cap spike must not turn provider callbacks or setup
 * actions into 500s. This adapter keeps Postgres as the canonical event
 * journal and records a pending NATS dispatch row in the same transaction.
 * Long-running workers own actual NATS delivery via redrivePending().
 */
export interface JournaledDispatchEventBusOptions {
  pool: Pool;
  listenConnectionString?: string;
  onError?: (err: unknown) => void;
}

export interface JournaledDispatchEventBus extends EventBus {
  close(): Promise<void>;
}

export async function createJournaledDispatchEventBus(
  opts: JournaledDispatchEventBusOptions,
): Promise<JournaledDispatchEventBus> {
  let subscriber: PostgresEventBus | null = null;

  async function publish(input: EventInput): Promise<PublishedEvent> {
    const client = await opts.pool.connect();
    let event: PublishedEvent | null = null;
    try {
      await client.query("begin");
      event = await appendPostgresEvent(client, input);
      await client.query(
        `insert into event_nats_dispatches (event_id, workspace_id)
         values ($1, $2)
         on conflict (event_id) do nothing`,
        [event.id, event.workspace_id],
      );
      await client.query("commit");
      return event;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function subscribe(
    event_type: string,
    handler: EventHandler,
  ): Promise<Subscription> {
    subscriber ??= await createPostgresEventBus({
      pool: opts.pool,
      listenConnectionString: opts.listenConnectionString,
      onError: opts.onError,
    });
    return subscriber.subscribe(event_type as never, handler as never);
  }

  return {
    publish: publish as EventBus["publish"],
    subscribe: subscribe as EventBus["subscribe"],
    async close() {
      const active = subscriber;
      subscriber = null;
      await active?.close();
    },
  };
}
