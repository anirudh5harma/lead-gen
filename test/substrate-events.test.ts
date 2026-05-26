import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";

test("event bus: publish + subscribe roundtrip", async () => {
  const bus = createInMemoryEventBus();
  const received: string[] = [];

  await bus.subscribe("signal.ingested", (e) => {
    received.push(e.payload.kind);
  });

  await bus.publish({
    workspace_id: randomUUID(),
    event_type: "signal.ingested",
    source: "system",
    payload: {
      signal_id: randomUUID(),
      source_id: null,
      kind: "funding",
      novelty_score: 0.87,
    },
  });

  // handlers are fire-and-forget; flush microtasks
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(received, ["funding"]);
});

test("event bus: rejects unknown event_type", async () => {
  const bus = createInMemoryEventBus();
  await assert.rejects(
    bus.publish({
      workspace_id: randomUUID(),
      // @ts-expect-error — intentional: testing the runtime guard
      event_type: "bogus.event",
      source: "system",
      payload: {},
    }),
    /Unknown event_type/,
  );
});

test("event bus: validates payload against the registry schema", async () => {
  const bus = createInMemoryEventBus();
  await assert.rejects(
    bus.publish({
      workspace_id: randomUUID(),
      event_type: "signal.matched",
      source: "system",
      // match_score must be 0..1
      // @ts-expect-error — intentional: shape mismatch
      payload: { signal_id: randomUUID(), match_score: 1.5 },
    }),
  );
});

test("event bus: wildcard subscriber receives every event", async () => {
  const bus = createInMemoryEventBus();
  const seen: string[] = [];
  await bus.subscribe("*", (e) => {
    seen.push(e.event_type);
  });

  const ws = randomUUID();
  await bus.publish({
    workspace_id: ws,
    event_type: "signal.ingested",
    source: "system",
    payload: {
      signal_id: randomUUID(),
      source_id: null,
      kind: "hiring",
      novelty_score: null,
    },
  });
  await bus.publish({
    workspace_id: ws,
    event_type: "draft.proposed",
    source: "agent",
    payload: {
      conversation_id: randomUUID(),
      message_id: randomUUID(),
      channel: "email",
      rep_id: randomUUID(),
    },
  });

  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, ["signal.ingested", "draft.proposed"]);
});

test("event bus: handler errors do not block other handlers or the publisher", async () => {
  const errors: unknown[] = [];
  const bus = createInMemoryEventBus({
    onHandlerError: (err) => errors.push(err),
  });
  const seen: string[] = [];

  await bus.subscribe("signal.ingested", () => {
    throw new Error("boom");
  });
  await bus.subscribe("signal.ingested", (e) => {
    seen.push(e.payload.kind);
  });

  await bus.publish({
    workspace_id: randomUUID(),
    event_type: "signal.ingested",
    source: "system",
    payload: {
      signal_id: randomUUID(),
      source_id: null,
      kind: "press_mention",
      novelty_score: 0.5,
    },
  });

  await new Promise((r) => setImmediate(r));
  assert.equal(errors.length, 1);
  assert.deepEqual(seen, ["press_mention"]);
});

test("event bus: idempotency key returns the original event without redispatch", async () => {
  const bus = createInMemoryEventBus();
  const ws = randomUUID();
  const seen: string[] = [];
  await bus.subscribe("signal.ingested", (e) => {
    seen.push(e.id);
  });

  const first = await bus.publish({
    workspace_id: ws,
    event_type: "signal.ingested",
    source: "webhook",
    producer_ref: "webhook:test",
    idempotency_key: "webhook:test:event-1",
    payload: {
      signal_id: randomUUID(),
      source_id: null,
      kind: "funding",
      novelty_score: 0.8,
    },
  });
  const duplicate = await bus.publish({
    workspace_id: ws,
    event_type: "signal.ingested",
    source: "webhook",
    producer_ref: "webhook:test",
    idempotency_key: "webhook:test:event-1",
    payload: {
      signal_id: randomUUID(),
      source_id: null,
      kind: "hiring",
      novelty_score: 0.2,
    },
  });

  await new Promise((r) => setImmediate(r));
  assert.equal(duplicate.id, first.id);
  assert.equal(bus.published.length, 1);
  assert.deepEqual(seen, [first.id]);
});
