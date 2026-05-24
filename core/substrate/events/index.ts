/**
 * Event bus — the only inter-component contract in pivot-v2.
 *
 * Every state change in the system flows through one of the typed events in
 * `registry.ts`. Handlers MUST NOT write to tables without first emitting a
 * corresponding event (see AGENTS.md "Build to the Architecture").
 *
 * Dev / test:
 *   import { createInMemoryEventBus } from "@/core/substrate/events";
 *
 * Production (when landed):
 *   import { createNatsEventBus } from "@/core/substrate/events";
 */

export * from "./types.ts";
export * from "./registry.ts";
export * from "./bus.ts";
export { createInMemoryEventBus } from "./adapters/in-memory.ts";
export type {
  InMemoryEventBus,
  InMemoryEventBusOptions,
} from "./adapters/in-memory.ts";
export { createNatsEventBus } from "./adapters/nats.ts";
export type { NatsEventBusOptions } from "./adapters/nats.ts";
export { createPostgresEventBus } from "./adapters/postgres.ts";
export type {
  PostgresEventBus,
  PostgresEventBusOptions,
} from "./adapters/postgres.ts";
