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

test("event bus: workspace.created carries replayable workspace metadata", async () => {
  const bus = createInMemoryEventBus();
  const event = await bus.publish({
    workspace_id: randomUUID(),
    event_type: "workspace.created",
    source: "user",
    producer_ref: randomUUID(),
    payload: {
      workspace_id: randomUUID(),
      created_by: randomUUID(),
      slug: "acme-gtm",
      name: "Acme GTM",
      settings: { mode: "product-activation" },
      owner_role: "owner",
    },
  });

  assert.equal(event.payload.slug, "acme-gtm");
  assert.equal(event.payload.owner_role, "owner");
});

test("event bus: workspace.member.accepted carries replayable membership state", async () => {
  const bus = createInMemoryEventBus();
  const event = await bus.publish({
    workspace_id: randomUUID(),
    event_type: "workspace.member.accepted",
    source: "system",
    producer_ref: "bootstrap:test",
    payload: {
      workspace_id: randomUUID(),
      user_id: randomUUID(),
      role: "owner",
    },
  });

  assert.equal(event.payload.role, "owner");
});

test("event bus: procedural memory seed is a typed replayable event", async () => {
  const bus = createInMemoryEventBus();
  const event = await bus.publish({
    workspace_id: randomUUID(),
    event_type: "rep.memory.procedural.seeded",
    source: "system",
    producer_ref: "bootstrap:test",
    payload: {
      exemplar_id: randomUUID(),
      rep_id: randomUUID(),
      pattern_key: "icp:fintech-founder|signal:funding|stage:cold_open",
      exemplar: {
        subject: "Congrats on the round",
        body: "Usually this is when pipeline quality matters more than volume.",
      },
      initial_score: 0.55,
    },
  });

  assert.equal(event.payload.initial_score, 0.55);
  assert.equal(event.payload.exemplar.subject, "Congrats on the round");
});

test("event bus: Rep role completion is a typed trust event", async () => {
  const bus = createInMemoryEventBus();
  const event = await bus.publish({
    workspace_id: randomUUID(),
    event_type: "rep.role.completed",
    source: "agent",
    payload: {
      rep_id: randomUUID(),
      role: "writer",
      action: "compose_email",
      conversation_id: randomUUID(),
      message_id: randomUUID(),
      summary: "Drafted a founder-led opener",
      output: {
        procedural_exemplar_count: 2,
      },
      completed_at: new Date().toISOString(),
    },
  });

  assert.equal(event.payload.role, "writer");
  assert.equal(event.payload.action, "compose_email");
});

test("event bus: workflow lifecycle accepts Restate invocation ids", async () => {
  const bus = createInMemoryEventBus();
  const event = await bus.publish({
    workspace_id: randomUUID(),
    event_type: "play.run.started",
    source: "system",
    payload: {
      play_id: randomUUID(),
      play_run_id: randomUUID(),
      workflow_run_id: "inv_14WQcnCYKEox10Gt8BNn2OhNDgcxcGYYxw",
      trigger_event_id: null,
    },
  });

  assert.equal(
    event.payload.workflow_run_id,
    "inv_14WQcnCYKEox10Gt8BNn2OhNDgcxcGYYxw",
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

test("event bus: event dispatch redrive is a typed audit event", async () => {
  const bus = createInMemoryEventBus();
  const event = await bus.publish({
    workspace_id: randomUUID(),
    event_type: "event.dispatch.redriven",
    source: "user",
    producer_ref: randomUUID(),
    causation_id: randomUUID(),
    payload: {
      event_id: randomUUID(),
      redriven_by: randomUUID(),
      status: "pending",
    },
  });

  assert.equal(event.payload.status, "pending");
});
