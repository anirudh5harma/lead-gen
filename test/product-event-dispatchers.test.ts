import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublishedEvent, Subscription } from "../core/substrate/events/index.ts";
import { registerProductEventDispatchers } from "../core/product/app.ts";

test("product event dispatchers wake Plays from typed signal and reply events", async () => {
  const handlers = new Map<string, (event: PublishedEvent) => Promise<void>>();
  const durableNames = new Map<string, string>();
  const unsubscribed = new Set<string>();
  const calls: Array<{ kind: "signal" | "reply"; limit: number | undefined }> = [];

  const subscriptions = await registerProductEventDispatchers(
    {
      async subscribe(eventType, handler, durableName): Promise<Subscription> {
        handlers.set(eventType, handler);
        durableNames.set(eventType, durableName);
        return {
          async unsubscribe() {
            unsubscribed.add(eventType);
          },
        };
      },
    },
    {
      limit: 7,
      async dispatchSignalPlays(opts) {
        calls.push({ kind: "signal", limit: opts.limit });
        return 1;
      },
      async dispatchReplyEmailPlays(opts) {
        calls.push({ kind: "reply", limit: opts.limit });
        return 1;
      },
    },
  );

  assert.equal(durableNames.get("signal.matched"), "product-signal-play-dispatcher-v1");
  assert.equal(durableNames.get("contact.resolved"), "product-contact-play-dispatcher-v1");
  assert.equal(durableNames.get("reply.classified"), "product-reply-play-dispatcher-v1");

  await handlers.get("signal.matched")?.(event("signal.matched"));
  await handlers.get("contact.resolved")?.(event("contact.resolved"));
  await handlers.get("reply.classified")?.(event("reply.classified"));

  assert.deepEqual(calls, [
    { kind: "signal", limit: 7 },
    { kind: "signal", limit: 7 },
    { kind: "reply", limit: 7 },
  ]);

  await Promise.all(subscriptions.map((subscription) => subscription.unsubscribe()));
  assert.deepEqual(
    unsubscribed,
    new Set(["signal.matched", "contact.resolved", "reply.classified"]),
  );
});

function event(event_type: string): PublishedEvent {
  return {
    id: `${event_type}:event`,
    workspace_id: "11111111-1111-4111-8111-111111111111",
    event_type,
    schema_version: 1,
    correlation_id: null,
    causation_id: null,
    source: "system",
    producer_ref: "test",
    idempotency_key: null,
    payload: {},
    occurred_at: new Date(0).toISOString(),
  };
}
