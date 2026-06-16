import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isOutlookRefreshReauthorizationError } from "../core/channels/email/adapters/outlook.ts";
import {
  graphMessageToInbound,
  reauthorizeOutlookSubscription,
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

test("Outlook subscription reauthorize posts to Graph without changing persisted state", async () => {
  const existing = {
    id: "subscription-1",
    resource: "/me/messages",
    expirationDateTime: "2026-06-01T00:00:00.000Z",
    clientState: "client-state",
    notificationUrl: "https://app.example/api/webhooks/outlook",
    lifecycleNotificationUrl: "https://app.example/api/webhooks/outlook",
    recorded_at: "2026-05-25T00:00:00.000Z",
  };
  const pool = {
    async query() {
      return { rows: [{ properties: { outlook_subscription: existing } }] };
    },
  };
  let requestedUrl: string | undefined;
  let requestedInit: RequestInit | undefined;

  const result = await reauthorizeOutlookSubscription({
    pool: pool as never,
    workspaceId: wsId,
    channelAccountId: channelId,
    accessToken: "fresh-access-token",
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestedInit = init;
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(
    requestedUrl,
    "https://graph.microsoft.com/v1.0/subscriptions/subscription-1/reauthorize",
  );
  assert.equal(requestedInit?.method, "POST");
  assert.equal(
    (requestedInit?.headers as Record<string, string>).Authorization,
    "Bearer fresh-access-token",
  );
  assert.equal(result, existing);
});

test("Outlook refresh reauthorization classifier only flags revoked/expired grants", () => {
  assert.equal(isOutlookRefreshReauthorizationError(400, "invalid_grant"), true);
  assert.equal(
    isOutlookRefreshReauthorizationError(
      400,
      "AADSTS50173: The provided grant has expired due to it being revoked.",
    ),
    true,
  );
  assert.equal(
    isOutlookRefreshReauthorizationError(400, "AADSTS700082: refresh token expired"),
    true,
  );
  assert.equal(
    isOutlookRefreshReauthorizationError(400, "invalid_scope: bad scope"),
    false,
  );
  assert.equal(
    isOutlookRefreshReauthorizationError(
      401,
      "invalid_client: client secret is wrong",
    ),
    false,
  );
});
