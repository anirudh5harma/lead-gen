import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSnsEnvelope,
  parseSnsNotification,
  SnsParseError,
} from "../core/channels/email/ses-inbound.ts";

function bouncePayload(workspaceId: string): string {
  return JSON.stringify({
    Type: "Notification",
    MessageId: "sns-1",
    Message: JSON.stringify({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        bouncedRecipients: [
          { emailAddress: "x@y.com", diagnosticCode: "550 user unknown" },
        ],
        timestamp: "2026-05-24T00:00:00Z",
      },
      mail: {
        messageId: "ses-msg-id",
        source: "maya@go.bombsell.com",
        destination: ["x@y.com"],
        tags: {
          workspace_id: [workspaceId],
          message_id: ["our-msg-id"],
        },
        commonHeaders: { from: ["maya@go.bombsell.com"], messageId: "<rfc-id@example.com>" },
      },
    }),
    Timestamp: "2026-05-24T00:00:00Z",
  });
}

function complaintPayload(workspaceId: string): string {
  return JSON.stringify({
    Type: "Notification",
    MessageId: "sns-2",
    Message: JSON.stringify({
      notificationType: "Complaint",
      complaint: {
        complainedRecipients: [{ emailAddress: "x@y.com" }],
        complaintFeedbackType: "abuse",
      },
      mail: {
        messageId: "ses-msg-id",
        tags: { workspace_id: [workspaceId] },
        commonHeaders: { messageId: "<rfc-id@example.com>" },
      },
    }),
    Timestamp: "2026-05-24T00:00:00Z",
  });
}

function receivedPayload(workspaceId: string, opts: { inReplyTo?: string } = {}): string {
  const headers = [
    { name: "From", value: "Anne Brown <anne@example.com>" },
    { name: "Subject", value: "Re: saw your series a" },
  ];
  if (opts.inReplyTo) {
    headers.push({ name: "In-Reply-To", value: `<${opts.inReplyTo}>` });
    headers.push({ name: "References", value: `<${opts.inReplyTo}>` });
  }
  return JSON.stringify({
    Type: "Notification",
    MessageId: "sns-3",
    Message: JSON.stringify({
      notificationType: "Received",
      mail: {
        messageId: "ses-in-1",
        source: "anne@example.com",
        commonHeaders: {
          from: ["Anne Brown <anne@example.com>"],
          subject: "Re: saw your series a",
          messageId: "<inbound-rfc@example.com>",
        },
        headers,
      },
      receipt: { timestamp: "2026-05-24T00:00:01Z" },
      content: Buffer.from("plain body").toString("base64"),
    }),
    MessageAttributes: { workspace_id: { Type: "String", Value: workspaceId } },
    Timestamp: "2026-05-24T00:00:01Z",
  });
}

test("sns parser: SubscriptionConfirmation returns subscribe URL", () => {
  const body = JSON.stringify({
    Type: "SubscriptionConfirmation",
    MessageId: "x",
    Message: "Please confirm",
    SubscribeURL: "https://sns.us-east-1.amazonaws.com/confirm?...",
    Timestamp: "now",
  });
  const env = parseSnsEnvelope(body);
  const parsed = parseSnsNotification(env);
  assert.equal(parsed.kind, "subscription_confirmation");
  if (parsed.kind === "subscription_confirmation") {
    assert.match(parsed.subscribeUrl, /^https:\/\/sns/);
  }
});

test("sns parser: SubscriptionConfirmation without SubscribeURL throws", () => {
  const body = JSON.stringify({
    Type: "SubscriptionConfirmation",
    MessageId: "x",
    Message: "Please confirm",
    Timestamp: "now",
  });
  assert.throws(() => parseSnsNotification(parseSnsEnvelope(body)), SnsParseError);
});

test("sns parser: Bounce → BounceEvent with workspace_id from SES tags", () => {
  const ws = "550e8400-e29b-41d4-a716-446655440000";
  const parsed = parseSnsNotification(parseSnsEnvelope(bouncePayload(ws)));
  assert.equal(parsed.kind, "bounce");
  if (parsed.kind === "bounce") {
    assert.equal(parsed.event.workspace_id, ws);
    assert.equal(parsed.event.bounce_type, "hard");
    assert.equal(parsed.event.recipient, "x@y.com");
    assert.match(String(parsed.event.detail), /user unknown/);
    // external_id prefers commonHeaders.messageId (RFC id) over SES internal id.
    assert.equal(parsed.event.external_id, "<rfc-id@example.com>");
  }
});

test("sns parser: Complaint maps to bounce_type='complaint'", () => {
  const ws = "550e8400-e29b-41d4-a716-446655440000";
  const parsed = parseSnsNotification(parseSnsEnvelope(complaintPayload(ws)));
  assert.equal(parsed.kind, "complaint");
  if (parsed.kind === "complaint") {
    assert.equal(parsed.event.bounce_type, "complaint");
    assert.equal(parsed.event.detail, "abuse");
  }
});

test("sns parser: Received → InboundEmail with headers parsed", () => {
  const ws = "550e8400-e29b-41d4-a716-446655440000";
  const parsed = parseSnsNotification(
    parseSnsEnvelope(receivedPayload(ws, { inReplyTo: "thread-1" })),
  );
  assert.equal(parsed.kind, "received");
  if (parsed.kind === "received") {
    assert.equal(parsed.inbound.workspace_id, ws);
    assert.equal(parsed.inbound.from.email, "anne@example.com");
    assert.equal(parsed.inbound.from.name, "Anne Brown");
    assert.equal(parsed.inbound.subject, "Re: saw your series a");
    assert.equal(parsed.inbound.in_reply_to, "thread-1");
    assert.deepEqual(parsed.inbound.references, ["thread-1"]);
    assert.equal(parsed.inbound.body_text, "plain body");
  }
});

test("sns parser: workspace_id resolver can override tag-based lookup", () => {
  const env = parseSnsEnvelope(
    JSON.stringify({
      Type: "Notification",
      MessageId: "sns-4",
      Message: JSON.stringify({
        notificationType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "x@y.com" }],
        },
        mail: { messageId: "x", commonHeaders: {} },
      }),
      Timestamp: "now",
    }),
  );
  assert.throws(() => parseSnsNotification(env), SnsParseError);

  const parsed = parseSnsNotification(env, () => "resolved-ws-id");
  assert.equal(parsed.kind, "bounce");
  if (parsed.kind === "bounce") {
    assert.equal(parsed.event.workspace_id, "resolved-ws-id");
  }
});

test("sns parser: unknown notificationType returns 'unsupported'", () => {
  const env = parseSnsEnvelope(
    JSON.stringify({
      Type: "Notification",
      MessageId: "x",
      Message: JSON.stringify({
        notificationType: "DeliveryDelay",
        mail: { messageId: "x", tags: { workspace_id: ["w"] }, commonHeaders: {} },
      }),
      Timestamp: "now",
    }),
  );
  const parsed = parseSnsNotification(env);
  assert.equal(parsed.kind, "unsupported");
});
