import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LinkedInProviderWebhook,
  lifecycleIdempotencyKey,
  providerStatus,
  resolveLinkedInProviderAuthUrl,
  verifyLinkedInProviderSignature,
} from "../core/channels/linkedin/index.ts";
import {
  signLinkedInOAuthState,
  verifyLinkedInOAuthState,
} from "../app/api/auth/linkedin/state.ts";

test("LinkedIn provider auth URL uses explicit auth endpoint or provider origin fallback", () => {
  assert.equal(
    resolveLinkedInProviderAuthUrl({
      LINKEDIN_PROVIDER_AUTH_URL: "https://provider.example/custom/start",
    })?.toString(),
    "https://provider.example/custom/start",
  );
  assert.equal(
    resolveLinkedInProviderAuthUrl({
      LINKEDIN_PROVIDER_URL: "https://provider.example/send",
    })?.toString(),
    "https://provider.example/auth/linkedin/start",
  );
  assert.equal(resolveLinkedInProviderAuthUrl({}), null);
});

test("LinkedIn OAuth state is signed and rejects tampering", () => {
  const token = signLinkedInOAuthState(
    {
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      nonce: "nonce",
      iat: Date.now(),
    },
    "secret",
  );

  assert.equal(
    verifyLinkedInOAuthState(token, "secret")?.workspace_id,
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(verifyLinkedInOAuthState(`${token}x`, "secret"), null);
});

test("LinkedIn provider webhook verifies sha256 HMAC signatures", () => {
  const body = JSON.stringify({ event: "rate_limited" });
  const signature = createHmac("sha256", "secret").update(body).digest("hex");

  assert.equal(
    verifyLinkedInProviderSignature(body, `sha256=${signature}`, "secret"),
    true,
  );
  assert.equal(
    verifyLinkedInProviderSignature(body, "sha256=deadbeef", "secret"),
    false,
  );
});

test("LinkedIn provider webhook maps lifecycle events to account statuses", () => {
  assert.equal(providerStatus("reauthorization_required"), "needs_reauth");
  assert.equal(providerStatus("rate_limited"), "rate_limited");
  assert.equal(providerStatus("suspended"), "suspended");
  assert.equal(providerStatus("disconnected"), "disconnected");
  assert.equal(providerStatus("errored"), null);
  assert.equal(providerStatus("connected"), null);
});

test("LinkedIn provider webhook preserves provider incident metadata", () => {
  const payload = LinkedInProviderWebhook.parse({
    event: "rate_limited",
    channel_account_id: "11111111-1111-4111-8111-111111111111",
    provider_account_id: "li_acc_123",
    account_display_name: "Maya LinkedIn",
    provider_event_id: "evt_limit_123",
    provider_incident_id: "inc_456",
    retry_after: "2026-06-02T11:00:00.000Z",
  });

  assert.equal(payload.account_display_name, "Maya LinkedIn");
  assert.equal(payload.provider_event_id, "evt_limit_123");
  assert.equal(payload.provider_incident_id, "inc_456");
  assert.equal(
    lifecycleIdempotencyKey(payload, payload.channel_account_id!),
    "linkedin-provider:11111111-1111-4111-8111-111111111111:rate_limited:evt_limit_123",
  );
});
