import assert from "node:assert/strict";
import { test } from "node:test";
import type { EmailChannel } from "../core/channels/email/index.ts";
import type { RunContext } from "../core/substrate/workflows/index.ts";
import { confirmQueuedEmailSend } from "../core/plays/email-send-confirmation.ts";

const initial = { status: "queued" as const, message_id: "message-1", external_id: null };

function context(confirm: Array<string | null>) {
  const published: Array<{ event_type: string; payload: unknown }> = [];
  const sleeps: number[] = [];
  const ctx = {
    correlation_id: null,
    async step(_name: string, fn: () => Promise<unknown>) { return fn(); },
    async sleep(ms: number) { sleeps.push(ms); },
    async publish(event_type: string, payload: unknown) {
      published.push({ event_type, payload });
      return {};
    },
  } as unknown as RunContext;
  const email = {
    name: "email",
    async send() { return initial; },
    async confirmQueued() {
      const external_id = confirm.shift() ?? null;
      return external_id
        ? { status: "sent" as const, message_id: "message-1", external_id }
        : initial;
    },
  } satisfies EmailChannel;
  return { ctx, email, published, sleeps };
}

test("durable email confirmation reaches sent without resending", async () => {
  const fx = context([null, "<mailbox-confirmed@example.com>"]);
  const result = await confirmQueuedEmailSend({
    email: fx.email,
    initial,
    message_id: "message-1",
    channelContext: { workspace_id: "workspace-1", bus: {} as never },
    ctx: fx.ctx,
  });
  assert.deepEqual(result, {
    status: "sent",
    message_id: "message-1",
    external_id: "<mailbox-confirmed@example.com>",
  });
  assert.deepEqual(fx.sleeps, [500]);
  assert.deepEqual(fx.published, []);
});

test("durable email confirmation ends in typed deferral after its deadline", async () => {
  const fx = context([]);
  const result = await confirmQueuedEmailSend({
    email: fx.email,
    initial,
    message_id: "message-1",
    channelContext: { workspace_id: "workspace-1", bus: {} as never },
    ctx: fx.ctx,
  });
  assert.equal(result.status, "deferred");
  assert.equal(fx.published.at(-1)?.event_type, "message.deferred");
  assert.deepEqual(fx.sleeps, [500, 1_500, 4_000, 15_000, 60_000, 300_000]);
});
