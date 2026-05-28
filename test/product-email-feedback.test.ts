import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  normalizeResendEmailWebhook,
  publishResendEmailWebhook,
} from "../core/product/email-feedback.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";

test("email feedback: normalizes Resend delivery webhooks", () => {
  assert.deepEqual(
    normalizeResendEmailWebhook({
      type: "email.delivered",
      created_at: "2026-02-22T23:41:12.126Z",
      data: {
        email_id: "resend-email-1",
      },
    }),
    {
      action: "delivered",
      external_id: "resend-email-1",
      occurred_at: "2026-02-22T23:41:12.126Z",
    },
  );
});

test("email feedback: normalizes bounce and complaint webhooks", () => {
  assert.deepEqual(
    normalizeResendEmailWebhook({
      type: "email.bounced",
      data: {
        email_id: "resend-email-2",
        bounce: {
          type: "Permanent",
          subType: "Suppressed",
          message: "Recipient is suppressed",
        },
      },
    }),
    {
      action: "bounced",
      external_id: "resend-email-2",
      bounce_type: "hard",
      reason: "Recipient is suppressed",
      occurred_at: null,
    },
  );

  assert.deepEqual(
    normalizeResendEmailWebhook({
      type: "email.complained",
      data: {
        email_id: "resend-email-3",
      },
    }),
    {
      action: "bounced",
      external_id: "resend-email-3",
      bounce_type: "complaint",
      reason: "recipient_marked_spam",
      occurred_at: null,
    },
  );
});

test("email feedback: ignores unsupported Resend webhooks", () => {
  assert.equal(
    normalizeResendEmailWebhook({
      type: "email.opened",
      data: {
        email_id: "resend-email-4",
      },
    }),
    null,
  );
});

test("email feedback: publishes provider webhook idempotency keys", async () => {
  const workspace_id = randomUUID();
  const message_id = randomUUID();
  const pool = {
    query: async () => ({
      rows: [
        {
          id: message_id,
          workspace_id,
        },
      ],
    }),
  };
  const bus = createInMemoryEventBus();

  const first = await publishResendEmailWebhook(
    pool as never,
    bus,
    {
      type: "email.delivered",
      data: {
        email_id: "resend-email-5",
      },
    },
    { providerEventId: "evt_123" },
  );
  const duplicate = await publishResendEmailWebhook(
    pool as never,
    bus,
    {
      type: "email.delivered",
      data: {
        email_id: "resend-email-5",
      },
    },
    { providerEventId: "evt_123" },
  );

  assert.equal(first.event_id, duplicate.event_id);
  assert.equal(bus.published.length, 1);
  assert.equal(bus.published[0].idempotency_key, "webhook:resend:evt_123");
  assert.deepEqual(bus.published[0].payload, {
    message_id,
    channel: "email",
    external_id: "resend-email-5",
    provider_event_id: "evt_123",
  });
});
