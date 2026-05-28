import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { summarizeEventTrace, type EventTraceEvent } from "../core/product/forensics.ts";

function event(event_type: string, occurred_at: string): EventTraceEvent {
  return {
    id: randomUUID(),
    event_type,
    correlation_id: "00000000-0000-4000-8000-000000000001",
    causation_id: null,
    source: "system",
    producer_ref: null,
    idempotency_key: null,
    payload: {},
    occurred_at,
    depth: 0,
  };
}

test("forensics: summarizes replay trace lifecycle and failures", () => {
  const summary = summarizeEventTrace(
    [
      event("draft.proposed", "2026-05-26T01:00:00.000Z"),
      event("draft.judged", "2026-05-26T01:00:01.000Z"),
      event("message.deferred", "2026-05-26T01:00:02.000Z"),
    ],
    "00000000-0000-4000-8000-000000000001",
  );

  assert.deepEqual(summary, {
    correlation_id: "00000000-0000-4000-8000-000000000001",
    event_count: 3,
    started_at: "2026-05-26T01:00:00.000Z",
    ended_at: "2026-05-26T01:00:02.000Z",
    root_event_type: "draft.proposed",
    terminal_event_type: "message.deferred",
    contains_failure: true,
  });
});
