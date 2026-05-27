import type {
  EmailChannel,
  EmailChannelOptions,
  EmailSendEnvelope,
  EmailTransport,
} from "./types.ts";

export interface DryRunEmailTransport extends EmailTransport {
  readonly sent: ReadonlyArray<EmailSendEnvelope & { external_id: string }>;
}

export function createDryRunEmailTransport(): DryRunEmailTransport {
  const sent: Array<EmailSendEnvelope & { external_id: string }> = [];
  return {
    get sent() {
      return sent;
    },
    async send(envelope) {
      const existing = sent.find(
        (candidate) => candidate.idempotency_key === envelope.idempotency_key,
      );
      if (existing) return { external_id: existing.external_id };
      const external_id = `dry-email-${sent.length + 1}`;
      sent.push({ ...envelope, external_id });
      return { external_id };
    },
  };
}

export function createOwnedDomainEmailChannel(opts: EmailChannelOptions): EmailChannel {
  const now = opts.now ?? (() => new Date());
  const sentByMessage = new Map<string, { external_id: string }>();

  return {
    name: "email",

    async send(conversation, draft, ctx) {
      if (!draft.eval_passed) {
        await ctx.bus.publish({
          workspace_id: ctx.workspace_id,
          event_type: "message.deferred",
          source: "system",
          producer_ref: ctx.producer_ref ?? "channel:email",
          correlation_id: ctx.correlation_id ?? null,
          idempotency_key: `channel:email:deferred:${draft.message_id}:eval_not_passed`,
          payload: {
            message_id: draft.message_id,
            channel: "email",
            defer_reason: "eval_not_passed",
            retry_after: null,
          },
        });
        return {
          status: "deferred",
          message_id: draft.message_id,
          defer_reason: "eval_not_passed",
          retry_after: null,
        };
      }

      if (!conversation.counterparty_email) {
        await ctx.bus.publish({
          workspace_id: ctx.workspace_id,
          event_type: "message.deferred",
          source: "system",
          producer_ref: ctx.producer_ref ?? "channel:email",
          correlation_id: ctx.correlation_id ?? null,
          idempotency_key: `channel:email:deferred:${draft.message_id}:missing_recipient_email`,
          payload: {
            message_id: draft.message_id,
            channel: "email",
            defer_reason: "missing_recipient_email",
            retry_after: null,
          },
        });
        return {
          status: "deferred",
          message_id: draft.message_id,
          defer_reason: "missing_recipient_email",
          retry_after: null,
        };
      }

      const priorSend = sentByMessage.get(draft.message_id);
      if (priorSend) {
        return {
          status: "sent",
          message_id: draft.message_id,
          external_id: priorSend.external_id,
        };
      }

      const account = opts.accounts.find(
        (candidate) =>
          candidate.status === "connected" &&
          candidate.daily_cap > 0 &&
          candidate.daily_used < candidate.daily_cap,
      );

      if (!account) {
        const retry_after = new Date(now().getTime() + 24 * 60 * 60 * 1000).toISOString();
        await ctx.bus.publish({
          workspace_id: ctx.workspace_id,
          event_type: "message.deferred",
          source: "system",
          producer_ref: ctx.producer_ref ?? "channel:email",
          correlation_id: ctx.correlation_id ?? null,
          idempotency_key: `channel:email:deferred:${draft.message_id}:deliverability_cap_exhausted`,
          payload: {
            message_id: draft.message_id,
            channel: "email",
            defer_reason: "deliverability_cap_exhausted",
            retry_after,
          },
        });
        return {
          status: "deferred",
          message_id: draft.message_id,
          defer_reason: "deliverability_cap_exhausted",
          retry_after,
        };
      }

      await ctx.bus.publish({
        workspace_id: ctx.workspace_id,
        event_type: "message.queued",
        source: "system",
        producer_ref: ctx.producer_ref ?? "channel:email",
        correlation_id: ctx.correlation_id ?? null,
        idempotency_key: `channel:email:queued:${draft.message_id}`,
        payload: {
          message_id: draft.message_id,
          channel: "email",
          scheduled_at: null,
        },
      });

      const result = await opts.transport.send({
        from: account.display_name,
        to: conversation.counterparty_email,
        subject: draft.subject ?? "",
        body: draft.body,
        account_id: account.id,
        idempotency_key: `message/${draft.message_id}`,
      });
      account.daily_used += 1;
      sentByMessage.set(draft.message_id, result);

      await ctx.bus.publish({
        workspace_id: ctx.workspace_id,
        event_type: "message.sent",
        source: "system",
        producer_ref: ctx.producer_ref ?? "channel:email",
        correlation_id: ctx.correlation_id ?? null,
        idempotency_key: `channel:email:sent:${draft.message_id}`,
        payload: {
          message_id: draft.message_id,
          channel: "email",
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
