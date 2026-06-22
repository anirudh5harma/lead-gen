import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AckPolicy,
  type Authenticator,
  connect,
  type Codec,
  credsAuthenticator,
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
 * NATS JetStream delivery adapter — the production transport named in
 * ARCHITECTURE.md "Opinionated Tech Stack". Application and worker
 * composition uses `createJournaledNatsEventBus()` so the canonical event
 * journal is appended before this adapter performs cross-process delivery.
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
  /**
   * Optional NATS credentials. Accepts EITHER:
   *   - the inline contents of a `.creds` file (detected by the
   *     `-----BEGIN NATS USER JWT-----` marker), or
   *   - a filesystem path to a `.creds` file.
   * Required for Synadia Cloud / NGS and any server using NKEY+JWT auth.
   * Username/password servers can instead embed creds in the `servers` URL.
   */
  credentials?: string;
  /** Stream + subject prefix. Defaults to "events". */
  streamPrefix?: string;
  /** Stream max age. Defaults to 30 days. */
  streamMaxAgeMs?: number;
  /** Stream max bytes. Defaults to 1 GiB because hosted NATS accounts may reject unlimited streams. */
  streamMaxBytes?: number;
  /** If true, ensure the stream exists at construct time. Defaults to true. */
  ensureStream?: boolean;
  /**
   * Override nats.js hostname pre-resolution. Synadia NGS expects the client
   * to dial the advertised hostname first so TLS/auth negotiation happens
   * against the server greeting instead of a pre-resolved IP.
   */
  resolve?: boolean;
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
  const authenticator = buildAuthenticator(opts.credentials);
  const nc = await connect({
    servers: opts.servers,
    name: "bombsell-event-bus",
    resolve: opts.resolve ?? shouldResolveServers(opts.servers),
    ignoreClusterUpdates: shouldIgnoreClusterUpdates(opts.servers),
    ...(authenticator ? { authenticator } : {}),
  });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();

  if (opts.ensureStream !== false) {
    await ensureStream(jsm, prefix, {
      max_age: (opts.streamMaxAgeMs ?? 30 * 24 * 60 * 60 * 1000) * 1_000_000, // nanoseconds
      max_bytes: opts.streamMaxBytes ?? DEFAULT_STREAM_MAX_BYTES,
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
      idempotency_key: input.idempotency_key ?? null,
      payload: parsed,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    };

    const subject = subjectFor(prefix, event.workspace_id, event.event_type);
    await js.publish(subject, codec.encode(event), {
      msgID: input.idempotency_key ?? event.id,
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

const DEFAULT_STREAM_MAX_BYTES = 1024 * 1024 * 1024;

interface SubscriptionStartOptions {
  js: JetStreamClient;
  jsm: JetStreamManager;
  prefix: string;
  filterSubject: string;
  handler: EventHandler;
  codec: Codec<unknown>;
  durableName?: string;
}

interface SubscriptionNames {
  consumerName: string;
  durableName?: string;
}

async function startSubscription(
  opts: SubscriptionStartOptions,
): Promise<JetStreamSubscription> {
  // Push-based JetStream subscription. nats.js creates the consumer with
  // the deliver_subject we hand it; the consumer is ephemeral unless
  // `durable_name` is set, in which case it persists across restarts.
  const names = subscriptionNames(opts.durableName);
  const sub = await subscribeJetStream(opts, names);
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

async function subscribeJetStream(
  opts: SubscriptionStartOptions,
  names: SubscriptionNames,
): Promise<JetStreamSubscription> {
  try {
    return await opts.js.subscribe(opts.filterSubject, subscriptionOptions(opts, names));
  } catch (err) {
    if (!opts.durableName || !isDurableQueueMigrationError(err)) throw err;
    await opts.jsm.consumers.delete(opts.prefix, names.consumerName);
    return opts.js.subscribe(opts.filterSubject, subscriptionOptions(opts, names));
  }
}

function subscriptionOptions(
  opts: SubscriptionStartOptions,
  names: SubscriptionNames,
) {
  const queueGroup = names.durableName ? `${names.consumerName}_workers` : undefined;
  return {
    config: {
      durable_name: names.durableName,
      name: names.consumerName,
      ack_policy: AckPolicy.Explicit,
      filter_subject: opts.filterSubject,
      deliver_subject: `_INBOX.${randomUUID()}`,
      ...(queueGroup ? { deliver_group: queueGroup } : {}),
    },
    ...(queueGroup ? { queue: queueGroup } : {}),
    mack: true, // manual ack — our handler decides
  };
}

function isDurableQueueMigrationError(err: unknown): boolean {
  return err instanceof Error && err.message === "durable requires no queue group";
}

async function ensureStream(
  jsm: JetStreamManager,
  prefix: string,
  cfg: { max_age: number; max_bytes: number },
): Promise<void> {
  const subject = `${prefix}.>`;
  let existing: Awaited<ReturnType<JetStreamManager["streams"]["info"]>> | null = null;
  try {
    existing = await jsm.streams.info(prefix);
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
    return;
  }

  const subjects = existing.config.subjects ?? [];
  const capturesSubject = subjects.includes(subject);
  const needsUpdate =
    !capturesSubject ||
    existing.config.max_age !== cfg.max_age ||
    existing.config.max_bytes !== cfg.max_bytes;
  if (!needsUpdate) return;

  try {
    // Stream exists. Update the subject filter + retention to keep it in sync.
    await jsm.streams.update(prefix, {
      subjects: capturesSubject ? subjects : [...subjects, subject],
      max_age: cfg.max_age,
      max_bytes: cfg.max_bytes,
    });
  } catch (err) {
    if (!capturesSubject) throw err;
    console.warn(
      `[nats event bus] stream '${prefix}' exists but retention update failed; using existing stream config`,
      err,
    );
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

const CREDS_MARKER = "-----BEGIN NATS USER JWT-----";

/**
 * Turn the `credentials` option into a NATS authenticator, or undefined
 * when no creds are configured (unauthenticated / URL-embedded auth).
 *
 * The value is treated as inline `.creds` content when it carries the
 * NATS USER JWT marker; otherwise it is read as a filesystem path. Exported
 * for unit testing the path/inline detection without a live connection.
 */
export function buildAuthenticator(
  credentials: string | undefined,
): Authenticator | undefined {
  const raw = credentials?.replace(/\\n/g, "\n").trim();
  if (!raw) return undefined;
  const contents = raw.includes(CREDS_MARKER) ? raw : readFileSync(raw, "utf8");
  return credsAuthenticator(new TextEncoder().encode(contents));
}

function shouldResolveServers(servers: string | string[]): boolean {
  const list = Array.isArray(servers) ? servers : [servers];
  return !list.some((server) => {
    try {
      const url = server.includes("://")
        ? new URL(server)
        : new URL(`nats://${server}`);
      return url.hostname.endsWith("ngs.global");
    } catch {
      return false;
    }
  });
}

function shouldIgnoreClusterUpdates(servers: string | string[]): boolean {
  const list = Array.isArray(servers) ? servers : [servers];
  return list.some((server) => {
    try {
      const url = server.includes("://")
        ? new URL(server)
        : new URL(`nats://${server}`);
      return url.hostname.endsWith("ngs.global");
    } catch {
      return false;
    }
  });
}

function safeSegment(s: string): string {
  // NATS subjects allow alnum, `.`, `_`, `-`. Workspace ids are UUIDs;
  // event types are dotted ASCII (e.g. 'signal.ingested'). Both are safe
  // — but a defensive replace keeps the regex obvious.
  return s.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function subscriptionNames(durableName?: string): SubscriptionNames {
  if (!durableName) {
    return {
      consumerName: `bombsell_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    };
  }
  const normalized = normalizeConsumerName(durableName);
  return {
    consumerName: normalized,
    durableName: normalized,
  };
}

export function normalizeConsumerName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("NATS consumer name required");
  }
  return trimmed.replace(/[^a-zA-Z0-9_\-]/g, "_");
}
