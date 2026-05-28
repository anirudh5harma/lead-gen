import { randomUUID } from "node:crypto";
import type { EventBus } from "../bus.ts";
import { eventRegistry, isKnownEventType } from "../registry.ts";
import type {
  EventHandler,
  EventInput,
  PublishedEvent,
  Subscription,
} from "../types.ts";

/**
 * In-memory event bus adapter. Use for unit tests and offline dev. Production
 * deployments swap this for the NATS adapter in `./nats.ts`.
 *
 * Handler invocation: fire-and-forget. Handler errors are logged via
 * `onHandlerError` (default: console.error) and do not affect other handlers
 * or the publisher's return value.
 */

export interface InMemoryEventBusOptions {
  onHandlerError?: (err: unknown, event: PublishedEvent) => void;
}

export interface InMemoryEventBus extends EventBus {
  /** Test helper: ordered list of every event that has been published. */
  readonly published: ReadonlyArray<PublishedEvent>;
  /** Test helper: clear all subscribers and published history. */
  reset(): void;
}

export function createInMemoryEventBus(
  opts: InMemoryEventBusOptions = {},
): InMemoryEventBus {
  const onHandlerError =
    opts.onHandlerError ??
    ((err, event) => {
      console.error(
        `[event-bus] handler for ${event.event_type} threw:`,
        err,
      );
    });

  const subscribers = new Map<string, Set<EventHandler>>();
  const wildcard = new Set<EventHandler>();
  const published: PublishedEvent[] = [];
  const publishedByIdempotency = new Map<string, PublishedEvent>();

  function dispatch(event: PublishedEvent): void {
    const typed = subscribers.get(event.event_type);
    if (typed) {
      for (const handler of typed) {
        try {
          const r = handler(event);
          if (r instanceof Promise) r.catch((err) => onHandlerError(err, event));
        } catch (err) {
          onHandlerError(err, event);
        }
      }
    }
    for (const handler of wildcard) {
      try {
        const r = handler(event);
        if (r instanceof Promise) r.catch((err) => onHandlerError(err, event));
      } catch (err) {
        onHandlerError(err, event);
      }
    }
  }

  async function publish(input: EventInput): Promise<PublishedEvent> {
    if (!isKnownEventType(input.event_type)) {
      throw new Error(`Unknown event_type: ${input.event_type}`);
    }
    const schema = eventRegistry[input.event_type];
    const parsed = schema.parse(input.payload);
    const dedupeKey = input.idempotency_key
      ? `${input.workspace_id}\u0000${input.event_type}\u0000${input.idempotency_key}`
      : null;
    if (dedupeKey) {
      const existing = publishedByIdempotency.get(dedupeKey);
      if (existing) return existing;
    }

    const event: PublishedEvent = {
      id: input.id ?? randomUUID(),
      workspace_id: input.workspace_id,
      event_type: input.event_type,
      schema_version: input.schema_version ?? 1,
      correlation_id: input.correlation_id ?? null,
      causation_id: input.causation_id ?? null,
      source: input.source,
      producer_ref: input.producer_ref ?? null,
      idempotency_key: input.idempotency_key ?? null,
      payload: parsed,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    };

    published.push(event);
    if (dedupeKey) publishedByIdempotency.set(dedupeKey, event);
    dispatch(event);
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
    get published() {
      return published;
    },
    reset() {
      subscribers.clear();
      wildcard.clear();
      published.length = 0;
      publishedByIdempotency.clear();
    },
  };
}
