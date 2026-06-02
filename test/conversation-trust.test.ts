import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  buildReplyProofs,
  type ConversationTrustApproval,
  type ConversationTrustEvent,
  type ConversationTrustMessage,
  type ConversationTrustOutcome,
} from "../core/product/conversation-trust.ts";

const now = new Date("2026-06-01T10:00:00.000Z");

function message(
  input: Partial<ConversationTrustMessage> & Pick<ConversationTrustMessage, "id" | "direction">,
): ConversationTrustMessage {
  return {
    id: input.id,
    channel: input.channel ?? "email",
    direction: input.direction,
    status: input.status ?? "delivered",
    subject: input.subject ?? null,
    body: input.body ?? null,
    external_id: input.external_id ?? null,
    eval_score: input.eval_score ?? null,
    eval_passed: input.eval_passed ?? null,
    intent_class: input.intent_class ?? null,
    intent_confidence: input.intent_confidence ?? null,
    sent_at: input.sent_at ?? null,
    created_at: input.created_at ?? now,
    provenance: input.provenance ?? {},
    properties: input.properties ?? {},
    eval_notes: input.eval_notes ?? {},
  };
}

test("buildReplyProofs groups reply intent, draft, approval, send, and outcome", () => {
  const inboundId = randomUUID();
  const draftId = randomUUID();
  const patternKey = "conversation:email|intent:positive|company:acme-payroll|stage:reply";
  const approval: ConversationTrustApproval = {
    id: randomUUID(),
    run_id: randomUUID(),
    kind: "inbound.email.reply",
    reason: "Maya drafted a reply",
    payload: {
      inbound_message_id: inboundId,
      message_id: draftId,
      pattern_key: patternKey,
    },
    decision: "approved",
    decided_by: randomUUID(),
    decided_at: now,
    decision_note: null,
    created_at: now,
  };
  const send: ConversationTrustEvent = {
    id: randomUUID(),
    event_type: "message.sent",
    source: "agent",
    payload: { message_id: draftId, status: "sent" },
    occurred_at: now,
  };
  const outcome: ConversationTrustOutcome = {
    id: randomUUID(),
    kind: "positive_reply",
    score: "1",
    attributed_message_id: draftId,
    attributed_signal_id: null,
    attributed_play_id: null,
    attributed_play_run_id: null,
    properties: {},
    occurred_at: now,
  };

  const proofs = buildReplyProofs({
    messages: [
      message({
        id: inboundId,
        direction: "inbound",
        subject: "Re: Series A expansion",
        intent_class: "positive",
        intent_confidence: "0.92",
      }),
      message({
        id: draftId,
        direction: "outbound",
        status: "sent",
        subject: "Re: Series A expansion",
        eval_score: "0.87",
        eval_passed: true,
        provenance: {
          inbound_message_id: inboundId,
          pattern_key: patternKey,
          exemplar_ids: [randomUUID(), randomUUID()],
        },
      }),
    ],
    events: [send],
    approvals: [approval],
    outcomes: [outcome],
  });

  assert.equal(proofs.length, 1);
  assert.equal(proofs[0]?.inbound_message_id, inboundId);
  assert.equal(proofs[0]?.draft_message_id, draftId);
  assert.equal(proofs[0]?.intent, "positive");
  assert.equal(proofs[0]?.pattern_key, patternKey);
  assert.equal(proofs[0]?.exemplar_count, 2);
  assert.equal(proofs[0]?.eval_score, "0.87");
  assert.equal(proofs[0]?.approval_decision, "approved");
  assert.equal(proofs[0]?.channel_event_type, "message.sent");
  assert.equal(proofs[0]?.outcome_kind, "positive_reply");
  assert.match(proofs[0]?.summary ?? "", /intent positive -> draft sent -> judge 0\.87/);
  assert.match(proofs[0]?.summary ?? "", /approval approved -> sent/);
  assert.match(proofs[0]?.summary ?? "", /outcome positive reply/);
});
