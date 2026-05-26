import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBriefSseEvent } from "../core/product/sse.ts";

test("brief SSE formatter emits valid event-stream frames", () => {
  const frame = formatBriefSseEvent({
    id: "event_1",
    event: "workflow.run.retried",
    retry: 2000,
    data: {
      ok: true,
      note: "line one\nline two",
    },
  });

  assert.match(frame, /^id: event_1\n/);
  assert.match(frame, /\nevent: workflow\.run\.retried\n/);
  assert.match(frame, /\nretry: 2000\n/);
  assert.match(frame, /\ndata: /);
  assert.ok(frame.endsWith("\n\n"));
  assert.match(frame, /line one\\nline two/);
});

test("brief SSE formatter sanitizes event names", () => {
  const frame = formatBriefSseEvent({
    event: "bad event/name",
    data: {},
  });

  assert.match(frame, /^event: bad_event_name\n/);
});
