import type {
  LinkedInChannel,
  LinkedInChannelOptions,
  LinkedInSendEnvelope,
  LinkedInTransport,
} from "./types.ts";

export interface DryRunLinkedInTransport extends LinkedInTransport {
  readonly sent: ReadonlyArray<LinkedInSendEnvelope & { external_id: string }>;
}

export function createDryRunLinkedInTransport(): DryRunLinkedInTransport {
  const sent: Array<LinkedInSendEnvelope & { external_id: string }> = [];
  return {
    get sent() {
      return sent;
    },
    async send(envelope) {
      const external_id = `dry-linkedin-${sent.length + 1}`;
      sent.push({ ...envelope, external_id });
      return { external_id };
    },
  };
}

export function createNativeLinkedInChannel(
  opts: LinkedInChannelOptions,
): LinkedInChannel {
  const now = opts.now ?? (() => new Date());

  return {
    name: opts.action,

    async send(conversation, draft, ctx) {
      if (!draft.eval_passed) {
        return publishDeferred(draft.message_id, opts.action, ctx, "eval_not_passed", null);
      }
      if (draft.channel !== opts.action) {
        return publishDeferred(
          draft.message_id,
          opts.action,
          ctx,
          "channel_mismatch",
          null,
        );
      }
      if (!conversation.counterparty_linkedin_url) {
        return publishDeferred(
          draft.message_id,
          opts.action,
          ctx,
          "missing_linkedin_profile",
          null,
        );
      }

      const account = opts.accounts.find(
        (candidate) =>
          (candidate.kind === "linkedin_session" || candidate.kind === "linkedin_oauth") &&
          candidate.status === "connected" &&
          candidate.daily_cap > 0 &&
          candidate.daily_used < candidate.daily_cap,
      );
      if (!account) {
        const retry_after = new Date(now().getTime() + 24 * 60 * 60 * 1000).toISOString();
        return publishDeferred(
          draft.message_id,
          opts.action,
          ctx,
          "linkedin_daily_cap_exhausted",
          retry_after,
        );
      }

      await ctx.bus.publish({
        workspace_id: ctx.workspace_id,
        event_type: "message.queued",
        source: "system",
        producer_ref: ctx.producer_ref ?? `channel:${opts.action}`,
        correlation_id: ctx.correlation_id ?? null,
        payload: {
          message_id: draft.message_id,
          channel: opts.action,
          scheduled_at: null,
        },
      });

      const result = await opts.transport.send({
        action: opts.action,
        account_id: account.id,
        from: account.display_name,
        target_profile_url: conversation.counterparty_linkedin_url,
        body: draft.body,
      });
      account.daily_used += 1;

      await ctx.bus.publish({
        workspace_id: ctx.workspace_id,
        event_type: "message.sent",
        source: "system",
        producer_ref: ctx.producer_ref ?? `channel:${opts.action}`,
        correlation_id: ctx.correlation_id ?? null,
        payload: {
          message_id: draft.message_id,
          channel: opts.action,
          external_id: result.external_id,
        },
      });

      return {
        status: "sent",
        message_id: draft.message_id,
        external_id: result.external_id,
      };
    },
  };
}

async function publishDeferred(
  message_id: string,
  channel: string,
  ctx: Parameters<LinkedInChannel["send"]>[2],
  defer_reason: string,
  retry_after: string | null,
) {
  await ctx.bus.publish({
    workspace_id: ctx.workspace_id,
    event_type: "message.deferred",
    source: "system",
    producer_ref: ctx.producer_ref ?? `channel:${channel}`,
    correlation_id: ctx.correlation_id ?? null,
    payload: {
      message_id,
      channel,
      defer_reason,
      retry_after,
    },
  });
  return {
    status: "deferred" as const,
    message_id,
    defer_reason,
    retry_after,
  };
}
