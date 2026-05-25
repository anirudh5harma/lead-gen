import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createNatsEventBus } from "../core/substrate/events/adapters/nats.ts";
import {
  subjectFor,
  subscribeSubject,
} from "../core/substrate/events/adapters/nats.ts";

const NATS_URL = process.env.NATS_URL ?? "nats://127.0.0.1:4222";

async function tryReachNats(): Promise<boolean> {
  try {
    const bus = await createNatsEventBus({
      servers: NATS_URL,
      streamPrefix: `bs_probe_${Date.now().toString(36)}`,
    });
    await bus.close();
    return true;
  } catch {
    return false;
  }
}

function until<T>(
  predicate: () => T | Promise<T> | undefined | null | false,
  { timeout = 3000, interval = 5 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  return (async () => {
    const deadline = Date.now() + timeout;
    while (true) {
      const v = await predicate();
      if (v) return v as T;
      if (Date.now() > deadline) throw new Error("until: timeout");
      await new Promise((r) => setTimeout(r, interval));
    }
  })();
}

test("nats subjects: per-workspace + per-event-type encoding round-trip", () => {
  const ws = "550e8400-e29b-41d4-a716-446655440000";
  // UUID dashes stay; event-type dots become underscores so each segment
  // collapses to a single NATS token.
  assert.equal(
    subjectFor("events", ws, "signal.ingested"),
    "events.550e8400-e29b-41d4-a716-446655440000.signal_ingested",
  );
  assert.equal(
    subscribeSubject("events", ws, "signal.ingested"),
    "events.550e8400-e29b-41d4-a716-446655440000.signal_ingested",
  );
  assert.equal(subscribeSubject("events", "*", "*"), "events.*.>");
  assert.equal(
    subscribeSubject("events", ws, "*"),
    "events.550e8400-e29b-41d4-a716-446655440000.>",
  );
});

test("nats event bus: publish + scoped subscribe roundtrip", async (t) => {
  if (!(await tryReachNats())) return t.skip("NATS server not reachable");
  const prefix = `bs_e2e_${Date.now().toString(36)}`;
  const bus = await createNatsEventBus({ servers: NATS_URL, streamPrefix: prefix });
  try {
    const ws = randomUUID();
    const seen: string[] = [];
    await bus.subscribeScoped(ws, "signal.ingested", (e) => {
      seen.push((e.payload as { kind: string }).kind);
    });

    await bus.publish({
      workspace_id: ws,
      event_type: "signal.ingested",
      source: "system",
      payload: {
        signal_id: randomUUID(),
        source_id: null,
        kind: "funding",
        novelty_score: 0.8,
      },
    });

    await until(() => seen.length === 1);
    assert.deepEqual(seen, ["funding"]);
  } finally {
    await bus.close();
  }
});

test("nats event bus: scoped subscribe ignores other workspaces", async (t) => {
  if (!(await tryReachNats())) return t.skip("NATS server not reachable");
  const prefix = `bs_iso_${Date.now().toString(36)}`;
  const bus = await createNatsEventBus({ servers: NATS_URL, streamPrefix: prefix });
  try {
    const wsA = randomUUID();
    const wsB = randomUUID();
    const seenA: string[] = [];
    await bus.subscribeScoped(wsA, "*", (e) => seenA.push(e.workspace_id));

    await bus.publish({
      workspace_id: wsB,
      event_type: "signal.dismissed",
      source: "system",
      payload: { signal_id: randomUUID(), reason: "off-icp" },
    });
    await bus.publish({
      workspace_id: wsA,
      event_type: "signal.dismissed",
      source: "system",
      payload: { signal_id: randomUUID(), reason: "off-icp" },
    });

    await until(() => seenA.length === 1);
    // Give a wsB straggler a chance to arrive incorrectly.
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(seenA, [wsA]);
  } finally {
    await bus.close();
  }
});

test("nats event bus: rejects unknown event types and bad payloads", async (t) => {
  if (!(await tryReachNats())) return t.skip("NATS server not reachable");
  const prefix = `bs_val_${Date.now().toString(36)}`;
  const bus = await createNatsEventBus({ servers: NATS_URL, streamPrefix: prefix });
  try {
    const ws = randomUUID();
    await assert.rejects(
      bus.publish({
        workspace_id: ws,
        // @ts-expect-error — intentional
        event_type: "bogus.event",
        source: "system",
        payload: {},
      }),
      /Unknown event_type/,
    );
    await assert.rejects(
      bus.publish({
        workspace_id: ws,
        event_type: "signal.matched",
        source: "system",
        // @ts-expect-error — score out of range
        payload: { signal_id: randomUUID(), match_score: 1.5 },
      }),
    );
  } finally {
    await bus.close();
  }
});

test("nats event bus: idempotent publish (msgID) collapses retries", async (t) => {
  if (!(await tryReachNats())) return t.skip("NATS server not reachable");
  const prefix = `bs_idem_${Date.now().toString(36)}`;
  const bus = await createNatsEventBus({ servers: NATS_URL, streamPrefix: prefix });
  try {
    const ws = randomUUID();
    const seen: string[] = [];
    await bus.subscribeScoped(ws, "signal.ingested", (e) => seen.push(e.id));

    const eventId = randomUUID();
    const payload = {
      signal_id: randomUUID(),
      source_id: null,
      kind: "funding",
      novelty_score: null,
    };
    await bus.publish({
      id: eventId,
      workspace_id: ws,
      event_type: "signal.ingested",
      source: "system",
      payload,
    });
    await bus.publish({
      id: eventId,
      workspace_id: ws,
      event_type: "signal.ingested",
      source: "system",
      payload,
    });

    await until(() => seen.length >= 1);
    await new Promise((r) => setTimeout(r, 150));
    // Duplicate window inside the stream collapses the second publish.
    assert.equal(seen.length, 1);
    assert.equal(seen[0], eventId);
  } finally {
    await bus.close();
  }
});
