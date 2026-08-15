import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmOutlookSentMessage } from "../core/channels/email/adapters/outlook.ts";

test("Outlook confirmation returns the real Internet Message ID from Sent Items", async () => {
  const marker = "5f149020-2b22-4de1-98d8-ddc6d187a12a";
  const externalId = await confirmOutlookSentMessage({
    accessToken: "access-token",
    marker,
    attempts: 1,
    fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-token");
      return new Response(JSON.stringify({
        value: [{
          id: "graph-message-id",
          internetMessageId: "<real-message-id@outlook.com>",
          internetMessageHeaders: [{ name: "x-bombsell-message-id", value: marker }],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(externalId, "<real-message-id@outlook.com>");
});

test("Outlook confirmation fails closed when Sent Items never contains the marker", async () => {
  const externalId = await confirmOutlookSentMessage({
    accessToken: "access-token",
    marker: "missing",
    attempts: 1,
    fetchImpl: async () => new Response(JSON.stringify({ value: [] }), { status: 200 }),
  });

  assert.equal(externalId, null);
});

test("Outlook confirmation surfaces Graph failures instead of treating them as misses", async () => {
  await assert.rejects(
    confirmOutlookSentMessage({
      accessToken: "token",
      marker: "message-1",
      attempts: 1,
      fetchImpl: async () => new Response("throttled", { status: 429 }),
    }),
    /lookup failed \(429\)/,
  );
});
