import type { EmailChannel } from "../channels/email/index.ts";
import type { ChannelSendContext, ChannelSendResult } from "../channels/types.ts";
import type { RunContext } from "../substrate/workflows/index.ts";

const CONFIRMATION_DELAYS_MS = [0, 500, 1_500, 4_000, 15_000, 60_000, 300_000] as const;

/**
 * Confirm an asynchronously accepted provider send inside the durable Play.
 * A queued result is deliberately not promoted to sent without mailbox proof.
 */
export async function confirmQueuedEmailSend(input: {
  email: EmailChannel;
  initial: ChannelSendResult;
  message_id: string;
  channelContext: ChannelSendContext;
  ctx: RunContext;
}): Promise<Exclude<ChannelSendResult, { status: "queued" }>> {
  if (input.initial.status !== "queued") {
    return input.initial;
  }
  if (!input.email.confirmQueued) return deferUnconfirmedSend(input);
  let result: ChannelSendResult = input.initial;
  for (let attempt = 0; attempt < CONFIRMATION_DELAYS_MS.length; attempt += 1) {
    const delay = CONFIRMATION_DELAYS_MS[attempt] ?? 0;
    if (delay > 0) await input.ctx.sleep(delay);
    result = await input.ctx.step(`sender.email.confirm.${attempt + 1}`, () =>
      input.email.confirmQueued!(input.message_id, input.channelContext),
    );
    if (result.status !== "queued") return result;
  }
  return deferUnconfirmedSend(input);
}

async function deferUnconfirmedSend(input: {
  message_id: string;
  ctx: RunContext;
}): Promise<Exclude<ChannelSendResult, { status: "queued" }>> {
  await input.ctx.publish("message.deferred", {
    message_id: input.message_id,
    channel: "email",
    defer_reason: "provider_confirmation_timeout",
    retry_after: null,
    detail: "Provider accepted the send, but Sent Items did not confirm it before the durable deadline.",
  });
  return {
    status: "deferred",
    message_id: input.message_id,
    defer_reason: "provider_confirmation_timeout",
    retry_after: null,
  };
}
