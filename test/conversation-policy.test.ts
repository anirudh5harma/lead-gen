import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateRelationshipOutreach,
  type RelationshipOutreachState,
} from "../core/primitives/conversation-policy.ts";

const now = new Date("2026-07-25T00:00:00.000Z");

function state(
  overrides: Partial<RelationshipOutreachState> = {},
): RelationshipOutreachState {
  return {
    conversation_id: "00000000-0000-4000-8000-000000000001",
    status: "awaiting_them",
    latest_outbound_status: "sent",
    latest_outbound_at: new Date("2026-07-24T00:00:00.000Z"),
    has_reply: false,
    has_blocking_outcome: false,
    ...overrides,
  };
}

test("relationship policy allows a first touch", () => {
  assert.deepEqual(evaluateRelationshipOutreach(null, now), {
    action: "allow",
    conversation_id: null,
  });
});

test("relationship policy applies one seven-day cap across channels", () => {
  assert.deepEqual(evaluateRelationshipOutreach(state(), now), {
    action: "suppress",
    conversation_id: "00000000-0000-4000-8000-000000000001",
    reason: "recipient_cooldown",
    retry_after: "2026-07-31T00:00:00.000Z",
  });
});

test("relationship policy re-evaluates after cooldown instead of sending a stale draft", () => {
  assert.deepEqual(
    evaluateRelationshipOutreach(
      state({ latest_outbound_at: new Date("2026-07-17T00:00:00.000Z") }),
      now,
    ),
    {
      action: "allow",
      conversation_id: "00000000-0000-4000-8000-000000000001",
    },
  );
});

test("relationship policy treats replies and do-not-contact outcomes as context-only", () => {
  assert.equal(
    evaluateRelationshipOutreach(state({ has_reply: true }), now).action,
    "suppress",
  );
  assert.deepEqual(
    evaluateRelationshipOutreach(
      state({ has_blocking_outcome: true }),
      now,
    ),
    {
      action: "suppress",
      conversation_id: "00000000-0000-4000-8000-000000000001",
      reason: "conversation_blocked",
      retry_after: null,
    },
  );
});
