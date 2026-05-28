import type {
  EventHandler,
  EventInput,
  PublishedEvent,
  Subscription,
} from "./types.ts";
import type { EventPayload, EventType } from "./registry.ts";

/**
 * The event bus. The only inter-component contract in pivot-v2.
 *
 * `publish` is typed: only event_types from the registry are accepted, and
 * payload must match the registered Zod schema. Validation happens inside
 * the bus implementation.
 *
 * `subscribe` accepts a specific event_type or '*' to receive every event in
 * the workspace. Handlers are fire-and-forget — errors are logged but do not
 * affect the publisher or other handlers.
 */
export interface EventBus {
  publish<T extends EventType>(
    event: Omit<EventInput<EventPayload<T>>, "event_type"> & {
      event_type: T;
    },
  ): Promise<PublishedEvent<EventPayload<T>>>;

  subscribe<T extends EventType>(
    event_type: T,
    handler: EventHandler<EventPayload<T>>,
  ): Promise<Subscription>;

  subscribe(
    event_type: "*",
    handler: EventHandler<unknown>,
  ): Promise<Subscription>;
}
