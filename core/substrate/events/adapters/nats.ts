import type { EventBus } from "../bus.ts";

/**
 * NATS JetStream event bus adapter — production target.
 *
 * STUB. Not yet wired. See ARCHITECTURE.md "Opinionated Tech Stack" for why
 * NATS JetStream is the production choice (replayable, lightweight, cheap;
 * upgrade path to Confluent Cloud at scale).
 *
 * Implementation contract for whoever lands this:
 *
 *   1. Open a JetStream client per-process (singleton, lazy).
 *   2. One stream per workspace OR one global stream subject-filtered by
 *      workspace_id (TBD — measure replay cost at scale before deciding).
 *   3. publish(): validate against eventRegistry, then publish to subject
 *      `events.<workspace_id>.<event_type>` with the envelope as the body.
 *      Also write to the `events` table (or have a consumer that does so) so
 *      the postgres-backed durable log stays the source of truth.
 *   4. subscribe(): create an ephemeral or durable consumer on the matching
 *      subject. Fan out to handler functions; ack on success.
 *   5. Honour `schema_version`. Reject publishes whose schema version is
 *      below the registered current (handle migrations explicitly).
 *
 * Until this lands, prefer `createInMemoryEventBus()` for dev and tests.
 */

export interface NatsEventBusOptions {
  servers: string | string[];
  /** Optional credentials path / inline JWT. */
  credentials?: string;
  /** Stream prefix; defaults to `events`. */
  streamPrefix?: string;
}

export function createNatsEventBus(_opts: NatsEventBusOptions): EventBus {
  throw new Error(
    "NATS event bus adapter is not yet implemented. See core/substrate/events/adapters/nats.ts for the contract.",
  );
}
