import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  graphMessageToInbound,
  type GraphMessage,
} from "../core/channels/email/outlook-subscription.ts";

const wsId = "550e8400-e29b-41d4-a716-446655440000";
const channelId = "550e8400-e29b-41d4-a716-446655440111";

test("graph parser: maps a typical Outlook reply to InboundEmail", () => {
  const message: GraphMessage = {
    id: "AAMkAD...",
    conversationId: "conv-1",
    internetMessageId: "<inbound@example.com>",
    subject: "Re: saw your series a",
    receivedDateTime: "2026-05-24T12:00:00Z",
    from: { emailAddress: { address: "anne@example.com", name: "Anne Brown" } },
    body: { contentType: "text", content: "Yes — Tuesday 3pm works." },
    internetMessageHeaders: [
      { name: "In-Reply-To", value: "<outbound@example.com>" },
      { name: "References", value: "<root@example.com> <outbound@example.com>" },
    ],
  };
  const inbound = graphMessageToInbound(message, wsId, channelId);
  assert.ok(inbound);
  assert.equal(inbound!.workspace_id, wsId);
  assert.equal(inbound!.channel_account_id, channelId);
  assert.equal(inbound!.external_id, "<inbound@example.com>");
  assert.equal(inbound!.external_thread_id, "conv-1");
  assert.equal(inbound!.from.email, "anne@example.com");
  assert.equal(inbound!.from.name, "Anne Brown");
  assert.equal(inbound!.subject, "Re: saw your series a");
  assert.equal(inbound!.body_text, "Yes — Tuesday 3pm works.");
  assert.equal(inbound!.in_reply_to, "outbound@example.com");
  assert.deepEqual(inbound!.references, ["root@example.com", "outbound@example.com"]);
});

test("graph parser: strips HTML to plain text and preserves body_html", () => {
  const message: GraphMessage = {
    id: randomUUID(),
    subject: "Re: x",
    receivedDateTime: "2026-05-24T12:00:00Z",
    from: { emailAddress: { address: "x@y.com" } },
    body: {
      contentType: "html",
      content:
        "<p>Hi <strong>Maya</strong>,</p><p>Let&#39;s chat.<br/>3pm Tuesday.</p><style>p{color:red}</style>",
    },
  };
  const inbound = graphMessageToInbound(message, wsId, channelId)!;
  assert.equal(inbound.body_html?.startsWith("<p>"), true);
  assert.match(inbound.body_text, /Hi Maya,/);
  assert.match(inbound.body_text, /Let's chat/);
  assert.match(inbound.body_text, /3pm Tuesday/);
  assert.ok(!inbound.body_text.includes("color:red"));
});

test("graph parser: returns null when sender address missing", () => {
  const message: GraphMessage = {
    id: randomUUID(),
    subject: "no sender",
    body: { contentType: "text", content: "ignore me" },
  };
  assert.equal(graphMessageToInbound(message, wsId, channelId), null);
});

test("graph parser: prefers internetMessageId over the Graph-internal id", () => {
  const message: GraphMessage = {
    id: "graph-internal",
    internetMessageId: "<rfc-id@example.com>",
    subject: "x",
    from: { emailAddress: { address: "x@y.com" } },
    body: { contentType: "text", content: "x" },
  };
  const inbound = graphMessageToInbound(message, wsId, channelId)!;
  assert.equal(inbound.external_id, "<rfc-id@example.com>");
});
