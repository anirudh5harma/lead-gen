/**
 * Event bus types. See core/substrate/events/registry.ts for the typed
 * event catalogue, and core/substrate/events/bus.ts for the EventBus
 * interface.
 */

export type EventSource = "system" | "agent" | "user" | "webhook" | "cron";

/**
 * Caller-supplied envelope when publishing. `id`, `occurred_at`, and
 * `schema_version` are filled in by the bus if not provided.
 */
export interface EventInput<TPayload = unknown> {
  id?: string;
  workspace_id: string;
  event_type: string;
  schema_version?: number;

  /** Root of a causation chain. Replay & forensics traverse by this. */
  correlation_id?: string | null;
  /** The event that directly caused this one (parent). */
  causation_id?: string | null;

  source: EventSource;
  /** e.g. `rep:<uuid>`, `channel:email`, `webhook:gmail`. */
  producer_ref?: string | null;

  payload: TPayload;
  occurred_at?: string;
}

/**
 * Fully-resolved published event. What handlers receive.
 */
export interface PublishedEvent<TPayload = unknown> {
  id: string;
  workspace_id: string;
  event_type: string;
  schema_version: number;
  correlation_id: string | null;
  causation_id: string | null;
  source: EventSource;
  producer_ref: string | null;
  payload: TPayload;
  occurred_at: string;
}

export type EventHandler<TPayload = unknown> = (
  event: PublishedEvent<TPayload>,
) => void | Promise<void>;

export interface Subscription {
  unsubscribe(): Promise<void>;
}
