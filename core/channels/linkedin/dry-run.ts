import type {
  LinkedInChannel,
  LinkedInChannelOptions,
  LinkedInSendEnvelope,
  LinkedInSessionAccount,
  LinkedInTransport,
} from "./types.ts";
import { LinkedInTransportError } from "./types.ts";

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
        return publishDeferred({
          message_id: draft.message_id,
          channel: opts.action,
          ctx,
          defer_reason: "eval_not_passed",
          retry_after: null,
        });
      }
      if (draft.channel !== opts.action) {
        return publishDeferred({
          message_id: draft.message_id,
          channel: opts.action,
          ctx,
          defer_reason: "channel_mismatch",
          retry_after: null,
        });
      }
      if (!conversation.counterparty_linkedin_url) {
        return publishDeferred({
          message_id: draft.message_id,
          channel: opts.action,
          ctx,
          defer_reason: "missing_linkedin_profile",
          retry_after: null,
          detail: "Counterparty has no LinkedIn profile URL.",
        });
      }

      const account = opts.accounts.find(
        (candidate) =>
          (candidate.kind === "linkedin_session" || candidate.kind === "linkedin_oauth") &&
          candidate.status === "connected" &&
          candidate.daily_cap > 0 &&
          candidate.daily_used < candidate.daily_cap,
      );
      if (!account) {
        const recovery = accountRecovery(opts.accounts, now);
        return publishDeferred({
          message_id: draft.message_id,
          channel: opts.action,
          ctx,
          ...recovery,
        });
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
          channel_account_id: account.id,
        },
      });

      let result;
      try {
        result = await opts.transport.send({
          action: opts.action,
          account_id: account.id,
          from: account.display_name,
          target_profile_url: conversation.counterparty_linkedin_url,
          body: draft.body,
        });
      } catch (error) {
        const recovery = transportRecovery(error, now);
        await ctx.bus.publish({
          workspace_id: ctx.workspace_id,
          event_type: "channel.account.errored",
          source: "system",
          producer_ref: ctx.producer_ref ?? `channel:${opts.action}`,
          correlation_id: ctx.correlation_id ?? null,
          payload: {
            channel_account_id: account.id,
            kind: account.kind,
            error: recovery.detail ?? recovery.defer_reason,
            status: recovery.account_status ?? null,
          },
        });
        return publishDeferred({
          message_id: draft.message_id,
          channel: opts.action,
          ctx,
          channel_account_id: account.id,
          ...recovery,
        });
      }
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
          channel_account_id: account.id,
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

interface LinkedInRecovery {
  defer_reason: string;
  retry_after: string | null;
  detail?: string | null;
  channel_account_id?: string | null;
  account_status?: LinkedInSessionAccount["status"] | null;
}

function retryTomorrow(now: () => Date): string {
  return new Date(now().getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function accountRecovery(
  accounts: LinkedInSessionAccount[],
  now: () => Date,
): LinkedInRecovery {
  const connected = accounts.find((account) => account.status === "connected");
  if (connected) {
    return {
      defer_reason: "linkedin_daily_cap_exhausted",
      retry_after: retryTomorrow(now),
      detail: `LinkedIn account ${connected.display_name} reached its daily cap.`,
      channel_account_id: connected.id,
    };
  }

  const account = accounts[0];
  if (!account) {
    return {
      defer_reason: "linkedin_account_unavailable",
      retry_after: null,
      detail: "No LinkedIn sending account is connected.",
    };
  }

  const common = {
    channel_account_id: account.id,
  };
  if (account.status === "needs_reauth") {
    return {
      ...common,
      defer_reason: "linkedin_needs_reauth",
      retry_after: null,
      detail: `LinkedIn account ${account.display_name} needs reauthorization.`,
      account_status: "needs_reauth",
    };
  }
  if (account.status === "rate_limited") {
    return {
      ...common,
      defer_reason: "linkedin_rate_limited",
      retry_after: retryTomorrow(now),
      detail: `LinkedIn account ${account.display_name} is rate-limited.`,
      account_status: "rate_limited",
    };
  }
  if (account.status === "suspended") {
    return {
      ...common,
      defer_reason: "linkedin_account_suspended",
      retry_after: null,
      detail: `LinkedIn account ${account.display_name} is suspended.`,
      account_status: "suspended",
    };
  }
  return {
    ...common,
    defer_reason: "linkedin_account_disconnected",
    retry_after: null,
    detail: `LinkedIn account ${account.display_name} is disconnected.`,
    account_status: "disconnected",
  };
}

function transportRecovery(error: unknown, now: () => Date): LinkedInRecovery {
  if (error instanceof LinkedInTransportError) {
    return {
      defer_reason: transportDeferReason(error.reason),
      retry_after:
        error.retry_after ??
        (["rate_limited", "provider_error_transient"].includes(error.reason)
          ? retryTomorrow(now)
          : null),
      detail: error.detail ?? error.message,
      account_status: transportAccountStatus(error.reason),
    };
  }
  return {
    defer_reason: "provider_error_transient",
    retry_after: retryTomorrow(now),
    detail: error instanceof Error ? error.message : "LinkedIn provider transport failed.",
    account_status: null,
  };
}

function transportDeferReason(reason: LinkedInTransportError["reason"]): string {
  const mapped: Record<LinkedInTransportError["reason"], string> = {
    rate_limited: "linkedin_rate_limited",
    needs_reauth: "linkedin_needs_reauth",
    suspended: "linkedin_account_suspended",
    disconnected: "linkedin_account_disconnected",
    provider_error_transient: "provider_error_transient",
    provider_error_permanent: "provider_error_permanent",
  };
  return mapped[reason];
}

function transportAccountStatus(
  reason: LinkedInTransportError["reason"],
): LinkedInSessionAccount["status"] | null {
  const mapped: Record<LinkedInTransportError["reason"], LinkedInSessionAccount["status"] | null> = {
    rate_limited: "rate_limited",
    needs_reauth: "needs_reauth",
    suspended: "suspended",
    disconnected: "disconnected",
    provider_error_transient: null,
    provider_error_permanent: "disconnected",
  };
  return mapped[reason];
}

async function publishDeferred(input: {
  message_id: string;
  channel: string;
  ctx: Parameters<LinkedInChannel["send"]>[2];
} & LinkedInRecovery) {
  await input.ctx.bus.publish({
    workspace_id: input.ctx.workspace_id,
    event_type: "message.deferred",
    source: "system",
    producer_ref: input.ctx.producer_ref ?? `channel:${input.channel}`,
    correlation_id: input.ctx.correlation_id ?? null,
    payload: {
      message_id: input.message_id,
      channel: input.channel,
      defer_reason: input.defer_reason,
      retry_after: input.retry_after,
      detail: input.detail ?? null,
      channel_account_id: input.channel_account_id ?? null,
    },
  });
  return {
    status: "deferred" as const,
    message_id: input.message_id,
    defer_reason: input.defer_reason,
    retry_after: input.retry_after,
  };
}
