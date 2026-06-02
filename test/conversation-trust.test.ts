import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  buildGateExplanations,
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
    channel_account_id: input.channel_account_id ?? null,
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
  assert.ok(
    proofs[0]?.gate_explanations.some((item) => /Channel sent/.test(item.summary)),
  );
  assert.match(proofs[0]?.summary ?? "", /intent positive -> draft sent -> judge 0\.87/);
  assert.match(proofs[0]?.summary ?? "", /approval approved -> sent/);
  assert.match(proofs[0]?.summary ?? "", /outcome positive reply/);
});

test("buildGateExplanations explains brand voice blocks from judge notes", () => {
  const draftId = randomUUID();
  const judged: ConversationTrustEvent = {
    id: randomUUID(),
    event_type: "draft.judged",
    source: "agent",
    payload: {
      message_id: draftId,
      eval_score: 0.35,
      passed: false,
      notes: {
        axes: {
          brand_voice: 0.35,
          voice_do_not: 1,
          voice_sample_overlap: 0.22,
          voice_low_hype: 0.35,
        },
        critique: "draft uses hype that conflicts with the Rep's voice",
        suggestions: ["replace hype with concrete context"],
      },
    },
    occurred_at: now,
  };

  const explanations = buildGateExplanations({
    message: message({
      id: draftId,
      direction: "outbound",
      status: "draft",
      eval_score: "0.35",
      eval_passed: false,
    }),
    events: [judged],
  });

  assert.equal(explanations[0]?.kind, "judge");
  assert.equal(explanations[0]?.status, "blocked");
  assert.equal(explanations[1]?.kind, "brand_voice");
  assert.equal(explanations[1]?.severity, "block");
  assert.match(explanations[1]?.summary ?? "", /Brand voice blocked at 0\.35/);
  assert.match(explanations[1]?.detail ?? "", /low hype 0\.35/);
  assert.match(explanations[1]?.detail ?? "", /replace hype/);
});

test("buildGateExplanations explains deliverability defers", () => {
  const draftId = randomUUID();
  const deferred: ConversationTrustEvent = {
    id: randomUUID(),
    event_type: "message.deferred",
    source: "agent",
    payload: {
      message_id: draftId,
      channel: "email",
      defer_reason: "deliverability_cap_exhausted",
      retry_after: "2026-06-02T10:00:00.000Z",
      detail: "warmed daily cap reached",
    },
    occurred_at: now,
  };

  const explanations = buildGateExplanations({
    message: message({
      id: draftId,
      direction: "outbound",
      status: "deferred",
    }),
    events: [deferred],
  });

  assert.equal(explanations.length, 1);
  assert.equal(explanations[0]?.kind, "deliverability");
  assert.equal(explanations[0]?.status, "deferred");
  assert.match(
    explanations[0]?.summary ?? "",
    /today's warmed sending capacity is exhausted/,
  );
  assert.match(explanations[0]?.detail ?? "", /warmed daily cap reached/);
  assert.match(explanations[0]?.detail ?? "", /Retry after/);
});

test("buildGateExplanations explains LinkedIn account recovery as channel state", () => {
  const draftId = randomUUID();
  const deferred: ConversationTrustEvent = {
    id: randomUUID(),
    event_type: "message.deferred",
    source: "agent",
    payload: {
      message_id: draftId,
      channel: "linkedin_dm",
      defer_reason: "linkedin_rate_limited",
      retry_after: "2026-06-02T10:00:00.000Z",
      detail: "LinkedIn account Maya LinkedIn is rate-limited.",
      channel_account_id: randomUUID(),
    },
    occurred_at: now,
  };

  const explanations = buildGateExplanations({
    message: message({
      id: draftId,
      direction: "outbound",
      channel: "linkedin_dm",
      status: "deferred",
    }),
    events: [deferred],
  });

  assert.equal(explanations.length, 1);
  assert.equal(explanations[0]?.kind, "channel");
  assert.equal(explanations[0]?.status, "deferred");
  assert.match(explanations[0]?.summary ?? "", /LinkedIn rate-limited the account/);
  assert.match(explanations[0]?.detail ?? "", /Maya LinkedIn/);
});

test("buildGateExplanations explains provider account lifecycle errors", () => {
  const draftId = randomUUID();
  const accountId = randomUUID();
  const accountError: ConversationTrustEvent = {
    id: randomUUID(),
    event_type: "channel.account.errored",
    source: "provider",
    payload: {
      channel_account_id: accountId,
      kind: "linkedin_oauth",
      status: "needs_reauth",
      error: "LinkedIn provider requires account reauthorization.",
      account_display_name: "Maya LinkedIn",
      provider_event_id: "evt_reauth_123",
      provider_incident_id: "inc_456",
      retry_after: "2026-06-02T11:00:00.000Z",
    },
    occurred_at: now,
  };

  const explanations = buildGateExplanations({
    message: message({
      id: draftId,
      direction: "outbound",
      channel: "linkedin_dm",
      status: "queued",
      channel_account_id: accountId,
    }),
    events: [accountError],
  });

  assert.equal(explanations.length, 1);
  assert.equal(explanations[0]?.kind, "channel");
  assert.equal(explanations[0]?.status, "blocked");
  assert.equal(explanations[0]?.severity, "block");
  assert.match(explanations[0]?.summary ?? "", /needs reauthorization/);
  assert.match(explanations[0]?.detail ?? "", /provider requires account reauthorization/);
  assert.match(explanations[0]?.detail ?? "", /Maya LinkedIn/);
  assert.match(explanations[0]?.detail ?? "", /Incident inc_456/);
  assert.match(explanations[0]?.detail ?? "", /Provider event evt_reauth_123/);
  assert.match(explanations[0]?.detail ?? "", /Retry after 2026-06-02T11:00:00.000Z/);
  assert.match(explanations[0]?.detail ?? "", new RegExp(accountId));
});
