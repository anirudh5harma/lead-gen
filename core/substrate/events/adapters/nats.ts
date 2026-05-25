import { randomUUID } from "node:crypto";
import {
  AckPolicy,
  connect,
  type Codec,
  type JetStreamClient,
  type JetStreamManager,
  type JetStreamSubscription,
  JSONCodec,
} from "nats";
import type { EventBus } from "../bus.ts";
import { eventRegistry, isKnownEventType } from "../registry.ts";
import type {
  EventHandler,
  EventInput,
  PublishedEvent,
  Subscription,
} from "../types.ts";

/**
 * NATS JetStream event bus — the production target named in
 * ARCHITECTURE.md "Opinionated Tech Stack". Persistent, replayable,
 * lightweight; upgrade path to Confluent Cloud at scale.
 *
 * Subject scheme (configurable via streamPrefix, default 'events'):
 *
 *   events.<workspace_id>.<event_type>
 *
 * The bus declares ONE stream that captures `events.>` (all subjects under
 * the prefix). Per-workspace isolation is by subscription subject filter,
 * not by stream — measure cost at scale before splitting streams per tenant.
 *
 * Subscribers can be ephemeral (in-process, dies with the process) or
 * durable (named consumer that resumes from its last ack on restart). The
 * default is ephemeral with explicit ack — production agents that need
 * "exactly-once-ish" delivery on restart should pass `durableName`.
 *
 * Schema validation: publish() validates the payload against the typed
 * registry BEFORE handing to NATS, so an invalid payload never gets
 * persisted to the stream.
 */

export interface NatsEventBusOptions {
  servers: string | string[];
  /** Optional credentials path or inline JWT. */
  credentials?: string;
  /** Stream + subject prefix. Defaults to "events". */
  streamPrefix?: string;
  /** Stream max age. Defaults to 30 days. */
  streamMaxAgeMs?: number;
  /** Stream max bytes (0 = unlimited). Defaults to 0. */
  streamMaxBytes?: number;
  /** If true, ensure the stream exists at construct time. Defaults to true. */
  ensureStream?: boolean;
}

export interface NatsEventBus extends EventBus {
  /** Drain and close the underlying NATS connection. */
  close(): Promise<void>;
  /** Workspace-scoped subscribe; foundation always sees every event in any case. */
  subscribeScoped<T extends keyof typeof eventRegistry>(
    workspace_id: string,
    event_type: T | "*",
    handler: EventHandler,
    opts?: { durableName?: string },
  ): Promise<Subscription>;
}

export async function createNatsEventBus(
  opts: NatsEventBusOptions,
): Promise<NatsEventBus> {
  const prefix = opts.streamPrefix ?? "events";
  const codec = JSONCodec();
  const nc = await connect({
    servers: opts.servers,
    name: "bombsell-event-bus",
  });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();

  if (opts.ensureStream !== false) {
    await ensureStream(jsm, prefix, {
      max_age: (opts.streamMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000) * 1_000_000, // nanoseconds
      max_bytes: opts.streamMaxBytes ?? -1,
    });
  }

  const subs: JetStreamSubscription[] = [];

  async function publish(input: EventInput): Promise<PublishedEvent> {
    if (!isKnownEventType(input.event_type)) {
      throw new Error(`Unknown event_type: ${input.event_type}`);
    }
    const schema = eventRegistry[input.event_type];
    const parsed = schema.parse(input.payload);

    const event: PublishedEvent = {
      id: input.id ?? randomUUID(),
      workspace_id: input.workspace_id,
      event_type: input.event_type,
      schema_version: input.schema_version ?? 1,
      correlation_id: input.correlation_id ?? null,
      causation_id: input.causation_id ?? null,
      source: input.source,
      producer_ref: input.producer_ref ?? null,
      payload: parsed,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    };

    const subject = subjectFor(prefix, event.workspace_id, event.event_type);
    await js.publish(subject, codec.encode(event), {
      msgID: event.id, // dedupe inside the stream's duplicate window
    });
    return event;
  }

  async function subscribe(
    event_type: string,
    handler: EventHandler,
  ): Promise<Subscription> {
    return startSubscription({
      js,
      jsm,
      prefix,
      filterSubject: subscribeSubject(prefix, "*", event_type),
      handler,
      codec,
    }).then((sub) => {
      subs.push(sub);
      return {
        unsubscribe: async () => {
          await sub.drain();
          const idx = subs.indexOf(sub);
          if (idx >= 0) subs.splice(idx, 1);
        },
      };
    });
  }

  async function subscribeScoped(
    workspace_id: string,
    event_type: string,
    handler: EventHandler,
    scopedOpts?: { durableName?: string },
  ): Promise<Subscription> {
    const sub = await startSubscription({
      js,
      jsm,
      prefix,
      filterSubject: subscribeSubject(prefix, workspace_id, event_type),
      handler,
      codec,
      durableName: scopedOpts?.durableName,
    });
    subs.push(sub);
    return {
      unsubscribe: async () => {
        await sub.drain();
        const idx = subs.indexOf(sub);
        if (idx >= 0) subs.splice(idx, 1);
      },
    };
  }

  return {
    publish: publish as EventBus["publish"],
    subscribe: subscribe as EventBus["subscribe"],
    subscribeScoped: subscribeScoped as NatsEventBus["subscribeScoped"],
    async close() {
      // Drain consumers, then drain the connection.
      for (const s of subs.splice(0)) {
        try {
          await s.drain();
        } catch {
          /* ignore */
        }
      }
      await nc.drain();
    },
  };
}

// ─── Internals ─────────────────────────────────────────────────────────────

interface SubscriptionStartOptions {
  js: JetStreamClient;
  jsm: JetStreamManager;
  prefix: string;
  filterSubject: string;
  handler: EventHandler;
  codec: Codec<unknown>;
  durableName?: string;
}

async function startSubscription(
  opts: SubscriptionStartOptions,
): Promise<JetStreamSubscription> {
  // Push-based JetStream subscription. nats.js creates the consumer with
  // the deliver_subject we hand it; the consumer is ephemeral unless
  // `durable_name` is set, in which case it persists across restarts.
  const consumerName =
    opts.durableName ??
    `bombsell_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const sub = await opts.js.subscribe(opts.filterSubject, {
    config: {
      durable_name: opts.durableName,
      name: consumerName,
      ack_policy: AckPolicy.Explicit,
      filter_subject: opts.filterSubject,
      deliver_subject: `_INBOX.${randomUUID()}`,
    },
    mack: true, // manual ack — our handler decides
  });
  void opts.jsm; // reserved for future stream/consumer admin

  // Pump messages.
  (async () => {
    for await (const m of sub) {
      let event: PublishedEvent;
      try {
        event = opts.codec.decode(m.data) as PublishedEvent;
      } catch (err) {
        // Malformed payload — ack so we don't replay it forever.
        m.ack();
        console.error("[nats event bus] malformed message:", err);
        continue;
      }
      try {
        const r = opts.handler(event);
        if (r instanceof Promise) {
          await r;
        }
        m.ack();
      } catch (err) {
        // Don't ack on handler failure — NATS will redeliver per ack_wait.
        console.error("[nats event bus] handler threw:", err);
        m.nak();
      }
    }
  })().catch((err) => console.error("[nats event bus] pump exited:", err));

  return sub;
}

async function ensureStream(
  jsm: JetStreamManager,
  prefix: string,
  cfg: { max_age: number; max_bytes: number },
): Promise<void> {
  const subject = `${prefix}.>`;
  try {
    await jsm.streams.info(prefix);
    // Stream exists. Update the subject filter + retention to keep it in sync.
    await jsm.streams.update(prefix, {
      subjects: [subject],
      max_age: cfg.max_age,
      max_bytes: cfg.max_bytes,
    });
  } catch {
    await jsm.streams.add({
      name: prefix,
      subjects: [subject],
      max_age: cfg.max_age,
      max_bytes: cfg.max_bytes,
      // 5 minute duplicate-detection window so client retries within reason
      // don't double-publish.
      duplicate_window: 5 * 60 * 1_000_000_000,
    });
  }
}

export function subjectFor(
  prefix: string,
  workspace_id: string,
  event_type: string,
): string {
  return `${prefix}.${safeSegment(workspace_id)}.${safeSegment(event_type)}`;
}

export function subscribeSubject(
  prefix: string,
  workspace_id: string | "*",
  event_type: string | "*",
): string {
  const ws = workspace_id === "*" ? "*" : safeSegment(workspace_id);
  const et = event_type === "*" ? ">" : safeSegment(event_type);
  return `${prefix}.${ws}.${et}`;
}

function safeSegment(s: string): string {
  // NATS subjects allow alnum, `.`, `_`, `-`. Workspace ids are UUIDs;
  // event types are dotted ASCII (e.g. 'signal.ingested'). Both are safe
  // — but a defensive replace keeps the regex obvious.
  return s.replace(/[^a-zA-Z0-9_\-]/g, "_");
}
