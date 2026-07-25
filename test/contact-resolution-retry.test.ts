import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunContext } from "../core/substrate/workflows/index.ts";
import {
  CONTACT_RESOLUTION_MAX_RETRIES,
  contactResolutionRetryDelayMs,
  createContactResolutionRetryWorkflow,
} from "../core/contacts/retry.ts";

const input = {
  workspace_id: "11111111-1111-4111-8111-111111111111",
  signal_id: "22222222-2222-4222-8222-222222222222",
  company_id: "33333333-3333-4333-8333-333333333333",
  play_id: "44444444-4444-4444-8444-444444444444",
  rep_id: "55555555-5555-4555-8555-555555555555",
  channel: "email" as const,
  retry_attempt: 0,
  deferred_event_id: "66666666-6666-4666-8666-666666666666",
  defer_reason: "no_email_ready_contact",
};

test("contact resolution retry uses bounded exponential backoff", () => {
  assert.equal(contactResolutionRetryDelayMs(1), 15 * 60_000);
  assert.equal(contactResolutionRetryDelayMs(2), 2 * 60 * 60_000);
  assert.equal(contactResolutionRetryDelayMs(3), 12 * 60 * 60_000);
  assert.equal(CONTACT_RESOLUTION_MAX_RETRIES, 3);
});

test("deferred contact resolution schedules the next durable retry request", async () => {
  const sleeps: number[] = [];
  const published: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  const workflow = createContactResolutionRetryWorkflow({
    now: () => new Date("2026-07-25T00:00:00.000Z"),
  });
  const output = await workflow.run(input, fakeContext(sleeps, published));

  assert.deepEqual(sleeps, [15 * 60_000]);
  assert.equal(output.decision, "retry_requested");
  assert.equal(output.attempt, 1);
  assert.deepEqual(published[0], {
    event_type: "contact.resolution.retry.requested",
    payload: {
      signal_id: input.signal_id,
      company_id: input.company_id,
      play_id: input.play_id,
      rep_id: input.rep_id,
      channel: "email",
      attempt: 1,
      source_deferred_event_id: input.deferred_event_id,
      defer_reason: input.defer_reason,
      requested_at: "2026-07-25T00:00:00.000Z",
    },
  });
});

test("exhausted contact resolution requests dead-letter processing without another sleep", async () => {
  const sleeps: number[] = [];
  const published: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  const workflow = createContactResolutionRetryWorkflow({
    now: () => new Date("2026-07-25T00:00:00.000Z"),
  });
  const output = await workflow.run(
    { ...input, retry_attempt: CONTACT_RESOLUTION_MAX_RETRIES },
    fakeContext(sleeps, published),
  );

  assert.deepEqual(sleeps, []);
  assert.equal(output.decision, "exhausted");
  assert.equal(output.attempt, CONTACT_RESOLUTION_MAX_RETRIES + 1);
  assert.equal(published[0]?.event_type, "contact.resolution.retry.requested");
  assert.equal(published[0]?.payload.exhausted, true);
});

function fakeContext(
  sleeps: number[],
  published: Array<{ event_type: string; payload: Record<string, unknown> }>,
): RunContext {
  return {
    run_id: "retry-run",
    execution_scope: "workspace",
    workspace_id: input.workspace_id,
    correlation_id: input.deferred_event_id,
    async step(_name, fn) {
      return fn();
    },
    async sleep(ms) {
      sleeps.push(ms);
    },
    async publish(event_type, payload) {
      published.push({
        event_type,
        payload: payload as Record<string, unknown>,
      });
      return {
        id: "77777777-7777-4777-8777-777777777777",
        workspace_id: input.workspace_id,
        event_type,
        schema_version: 1,
        correlation_id: input.deferred_event_id,
        causation_id: input.deferred_event_id,
        source: "system",
        producer_ref: "test",
        idempotency_key: null,
        payload,
        occurred_at: "2026-07-25T00:00:00.000Z",
      };
    },
    async awaitEvent() {
      throw new Error("not used");
    },
    async requestApproval() {
      throw new Error("not used");
    },
  };
}
