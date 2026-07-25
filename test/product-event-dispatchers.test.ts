import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { PublishedEvent, Subscription } from "../core/substrate/events/index.ts";
import {
  dispatchSignalMatchingWorkflowFromIngestedEvent,
  registerProductEventDispatchers,
} from "../core/product/app.ts";

test("product event dispatchers wake Plays from typed signal and reply events", async () => {
  const handlers = new Map<string, Array<(event: PublishedEvent) => Promise<void>>>();
  const durableNames = new Map<string, string[]>();
  const unsubscribed = new Set<string>();
  const calls: Array<{
    kind:
      | "signal_matching"
      | "signal"
      | "contact_retry_schedule"
      | "contact_retry_dispatch"
      | "reply"
      | "meeting_prep"
      | "linkedin_accepted_followup";
    limit: number | undefined;
    signal_id?: string;
  }> = [];

  const subscriptions = await registerProductEventDispatchers(
    {
      async subscribe(eventType, handler, durableName): Promise<Subscription> {
        handlers.set(eventType, [...(handlers.get(eventType) ?? []), handler]);
        durableNames.set(eventType, [...(durableNames.get(eventType) ?? []), durableName]);
        return {
          async unsubscribe() {
            unsubscribed.add(durableName);
          },
        };
      },
    },
    {
      limit: 7,
      async dispatchSignalMatching(event) {
        calls.push({
          kind: "signal_matching",
          limit: undefined,
          signal_id: (event.payload as { signal_id?: string }).signal_id,
        });
        return 1;
      },
      async dispatchSignalPlays(opts) {
        calls.push({ kind: "signal", limit: opts.limit });
        return 1;
      },
      async scheduleContactResolutionRetry(event) {
        calls.push({
          kind: "contact_retry_schedule",
          limit: undefined,
          signal_id: (event.payload as { signal_id?: string }).signal_id,
        });
        return 1;
      },
      async dispatchContactResolutionRetry(event) {
        calls.push({
          kind: "contact_retry_dispatch",
          limit: undefined,
          signal_id: (event.payload as { signal_id?: string }).signal_id,
        });
        return 1;
      },
      async dispatchLinkedInAcceptedFollowups(opts) {
        calls.push({
          kind: "linkedin_accepted_followup",
          limit: opts.limit,
        });
        return 1;
      },
      async dispatchReplyEmailPlays(opts) {
        calls.push({ kind: "reply", limit: opts.limit });
        return 1;
      },
      async dispatchMeetingPrep(opts) {
        calls.push({ kind: "meeting_prep", limit: opts.limit });
        return 1;
      },
    },
  );

  assert.deepEqual(durableNames.get("signal.ingested"), [
    "product-signal-matching-workflow-dispatcher-v1",
  ]);
  assert.deepEqual(durableNames.get("signal.matched"), ["product-signal-play-dispatcher-v1"]);
  assert.deepEqual(durableNames.get("contact.resolved"), ["product-contact-play-dispatcher-v1"]);
  assert.deepEqual(durableNames.get("contact.resolution.deferred"), [
    "product-contact-resolution-retry-scheduler-v1",
  ]);
  assert.deepEqual(durableNames.get("contact.resolution.retry.requested"), [
    "product-contact-resolution-retry-dispatcher-v1",
  ]);
  assert.deepEqual(durableNames.get("reply.classified"), [
    "product-reply-play-dispatcher-v1",
    "product-meeting-prep-dispatcher-v1",
  ]);
  assert.deepEqual(durableNames.get("linkedin.connection.accepted"), [
    "product-linkedin-accepted-followup-dispatcher-v1",
  ]);

  await Promise.all((handlers.get("signal.ingested") ?? []).map((handler) =>
    handler(event("signal.ingested", { signal_id: "22222222-2222-4222-8222-222222222222" }))
  ));
  await Promise.all((handlers.get("signal.matched") ?? []).map((handler) =>
    handler(event("signal.matched"))
  ));
  await Promise.all((handlers.get("contact.resolved") ?? []).map((handler) =>
    handler(event("contact.resolved"))
  ));
  await Promise.all((handlers.get("contact.resolution.deferred") ?? []).map((handler) =>
    handler(event("contact.resolution.deferred", {
      signal_id: "22222222-2222-4222-8222-222222222222",
    }))
  ));
  await Promise.all((handlers.get("contact.resolution.retry.requested") ?? []).map((handler) =>
    handler(event("contact.resolution.retry.requested", {
      signal_id: "22222222-2222-4222-8222-222222222222",
    }))
  ));
  await Promise.all((handlers.get("reply.classified") ?? []).map((handler) =>
    handler(event("reply.classified"))
  ));
  await Promise.all((handlers.get("linkedin.connection.accepted") ?? []).map((handler) =>
    handler(event("linkedin.connection.accepted"))
  ));

  assert.deepEqual(calls, [
    {
      kind: "signal_matching",
      limit: undefined,
      signal_id: "22222222-2222-4222-8222-222222222222",
    },
    { kind: "signal", limit: 7 },
    { kind: "signal", limit: 7 },
    {
      kind: "contact_retry_schedule",
      limit: undefined,
      signal_id: "22222222-2222-4222-8222-222222222222",
    },
    {
      kind: "contact_retry_dispatch",
      limit: undefined,
      signal_id: "22222222-2222-4222-8222-222222222222",
    },
    { kind: "reply", limit: 7 },
    { kind: "meeting_prep", limit: 7 },
    { kind: "linkedin_accepted_followup", limit: 7 },
  ]);

  await Promise.all(subscriptions.map((subscription) => subscription.unsubscribe()));
  assert.deepEqual(
    unsubscribed,
    new Set([
      "product-signal-matching-workflow-dispatcher-v1",
      "product-signal-play-dispatcher-v1",
      "product-contact-play-dispatcher-v1",
      "product-contact-resolution-retry-scheduler-v1",
      "product-contact-resolution-retry-dispatcher-v1",
      "product-reply-play-dispatcher-v1",
      "product-meeting-prep-dispatcher-v1",
      "product-linkedin-accepted-followup-dispatcher-v1",
    ]),
  );
});

test("signal matching dispatcher starts the durable matching workflow with causal ids", async () => {
  const starts: unknown[] = [];
  const pool = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /from workspace_members/);
      assert.deepEqual(params, ["11111111-1111-4111-8111-111111111111"]);
      return { rows: [{ user_id: "33333333-3333-4333-8333-333333333333" }] };
    },
  } as unknown as Pool;
  const eventId = "44444444-4444-4444-8444-444444444444";
  const result = await dispatchSignalMatchingWorkflowFromIngestedEvent(
    event("signal.ingested", {
      signal_id: "22222222-2222-4222-8222-222222222222",
    }, eventId),
    {
      pool,
      workflows: {
        async start(input) {
          starts.push(input);
          return {};
        },
      },
    },
  );

  assert.equal(result, 1);
  assert.deepEqual(starts, [{
    workspace_id: "11111111-1111-4111-8111-111111111111",
    workflow_name: "workspace.signal.matching",
    idempotency_key:
      "signal-match:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
    correlation_id: eventId,
    causation_id: eventId,
    input: {
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "33333333-3333-4333-8333-333333333333",
      signal_id: "22222222-2222-4222-8222-222222222222",
      thread_id:
        "signal-match:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
      correlation_id: eventId,
      causation_event_id: eventId,
    },
  }]);
});

test("signal matching dispatcher ignores malformed Signal ingress payloads", async () => {
  let queried = false;
  const result = await dispatchSignalMatchingWorkflowFromIngestedEvent(
    event("signal.ingested", {}),
    {
      pool: {
        async query() {
          queried = true;
          return { rows: [] };
        },
      } as unknown as Pool,
      workflows: {
        async start() {
          throw new Error("not reached");
        },
      },
    },
  );

  assert.equal(result, 0);
  assert.equal(queried, false);
});

function event(
  event_type: string,
  payload: Record<string, unknown> = {},
  id = `${event_type}:event`,
): PublishedEvent {
  return {
    id,
    workspace_id: "11111111-1111-4111-8111-111111111111",
    event_type,
    schema_version: 1,
    correlation_id: null,
    causation_id: null,
    source: "system",
    producer_ref: "test",
    idempotency_key: null,
    payload,
    occurred_at: new Date(0).toISOString(),
  };
}
