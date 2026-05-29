import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../../substrate/events/index.ts";
import { projectMessageLifecycleEvent } from "../message-lifecycle.ts";
import {
  checkFrequencyCap,
  refundSend,
  reserveSend,
  type FrequencyCapOptions,
} from "./caps.ts";
import { readEvalState } from "./eval-gate.ts";
import {
  canSendVia,
  getSendingDomain,
  type SendingDomainRow,
} from "./warmup.ts";
import type {
  DeferReason,
  EmailDraft,
  EmailSubChannel,
  SendOptions,
  SendResult,
} from "./types.ts";
import type { OutlookSender } from "./adapters/outlook.ts";
import type { SesSender } from "./adapters/ses.ts";

/**
 * Public email send. Picks the right sub-channel adapter, enforces the
 * hot-path eval gate, daily cap, frequency cap, and (for owned domains)
 * warmup state. Every defer emits `message.deferred` onto the bus; every
 * successful send emits `message.queued` + `message.sent`. Message state is
 * materialized by the shared lifecycle projector so replay observes the same
 * contract as the hot path.
 *
 * Hard rule (ARCHITECTURE.md): no path through this function sends without
 * a prior passing draft.judged event for the same message_id. The check
 * is the FIRST thing.
 */

export interface EmailChannelDeps {
  pool: Pool;
  bus: EventBus;
  ses: SesSender;
  outlook: OutlookSender;
  /** Optional override of frequency cap policy. */
  frequencyCap?: FrequencyCapOptions;
  /** SES configuration set name (for bounce/complaint events). */
  sesConfigurationSet?: string;
}

interface ConversationRow {
  workspace_id: string;
  counterparty_person_id: string;
}

interface ChannelAccountRow {
  id: string;
  kind: string;
  status: string;
  display_name: string;
}

interface SendingDomainPicked extends SendingDomainRow {
  from_address: string;
}

export function createEmailChannel(deps: EmailChannelDeps) {
  return {
    send(opts: SendOptions): Promise<SendResult> {
      return sendEmail(deps, opts);
    },
  };
}

async function sendEmail(
  deps: EmailChannelDeps,
  opts: SendOptions,
): Promise<SendResult> {
  const { pool, bus } = deps;

  // 1. Eval gate enforcement — the only place this rule is enforced.
  const evalState = await readEvalState(pool, opts.workspace_id, opts.message_id);
  if (evalState !== "passed") {
    const reason: DeferReason =
      evalState === "rejected" ? "judge_failed" : "not_judged";
    await emitDeferred(deps, opts, reason);
    return {
      status: "deferred",
      message_id: opts.message_id,
      reason,
    };
  }

  // 2. Recipient frequency cap (across all Reps in this workspace).
  const conversation = await loadConversation(pool, opts.workspace_id, opts.conversation_id);
  if (!conversation) {
    await emitDeferred(deps, opts, "provider_error_permanent", "conversation not found");
    return {
      status: "deferred",
      message_id: opts.message_id,
      reason: "provider_error_permanent",
      detail: "conversation not found",
    };
  }
  const freq = await checkFrequencyCap(
    pool,
    opts.workspace_id,
    conversation.counterparty_person_id,
    deps.frequencyCap,
  );
  if (!freq.allowed) {
    await emitDeferred(
      deps,
      opts,
      "frequency_cap_reached",
      `${freq.count}/${freq.max} in last ${freq.window_hours}h`,
    );
    return {
      status: "deferred",
      message_id: opts.message_id,
      reason: "frequency_cap_reached",
      detail: `${freq.count}/${freq.max} in last ${freq.window_hours}h`,
    };
  }

  // 3. Account status + sub-channel sanity check.
  const account = await loadChannelAccount(pool, opts.workspace_id, opts.channel_account_id);
  if (!account) {
    await emitDeferred(deps, opts, "missing_credentials", "channel_account not found");
    return {
      status: "deferred",
      message_id: opts.message_id,
      reason: "missing_credentials",
      detail: "channel_account not found",
    };
  }
  if (account.status !== "connected") {
    const reason: DeferReason =
      account.status === "rate_limited"
        ? "account_rate_limited"
        : "account_disconnected";
    await emitDeferred(deps, opts, reason, `account status=${account.status}`);
    return { status: "deferred", message_id: opts.message_id, reason };
  }
  const expectedKind =
    opts.sub_channel === "owned_domain" ? "email_domain" : "oauth_outlook";
  if (account.kind !== expectedKind) {
    await emitDeferred(
      deps,
      opts,
      "provider_error_permanent",
      `account kind=${account.kind} does not match sub_channel=${opts.sub_channel}`,
    );
    return {
      status: "deferred",
      message_id: opts.message_id,
      reason: "provider_error_permanent",
    };
  }

  // 4. Sub-channel-specific gates.
  let pickedDomain: SendingDomainPicked | null = null;
  if (opts.sub_channel === "owned_domain") {
    pickedDomain = await pickSendingDomain(pool, opts, account);
    if (!pickedDomain) {
      await emitDeferred(deps, opts, "domain_not_ready", "no usable sending domain");
      return {
        status: "deferred",
        message_id: opts.message_id,
        reason: "domain_not_ready",
      };
    }
    const todayCount = await countSentTodayForDomain(pool, pickedDomain.id);
    const gate = canSendVia(pickedDomain, todayCount);
    if (!gate.allowed) {
      await emitDeferred(deps, opts, gate.reason as DeferReason);
      return {
        status: "deferred",
        message_id: opts.message_id,
        reason: gate.reason as DeferReason,
      };
    }
  }

  // 5. Atomic daily-cap reservation on the channel account.
  const reserved = await reserveSend(pool, account.id);
  if (!reserved) {
    await emitDeferred(deps, opts, "daily_cap_reached");
    return {
      status: "deferred",
      message_id: opts.message_id,
      reason: "daily_cap_reached",
    };
  }

  // 6. Emit message.queued; the projector owns message row materialization.
  const queuedEvent = await bus.publish({
    workspace_id: opts.workspace_id,
    event_type: "message.queued",
    source: "system",
    producer_ref: `channel:email:${opts.sub_channel}`,
    correlation_id: opts.conversation_id,
    payload: {
      message_id: opts.message_id,
      channel: "email",
      scheduled_at: null,
      channel_account_id: account.id,
    },
  });
  await projectMessageLifecycleEvent(pool, queuedEvent);

  // 7. Actual provider send.
  try {
    let externalId: string;
    if (opts.sub_channel === "owned_domain" && pickedDomain) {
      const result = await deps.ses.send({
        draft: opts.draft,
        from: pickedDomain.from_address,
        configurationSetName: deps.sesConfigurationSet,
        tags: [
          { Name: "workspace_id", Value: opts.workspace_id },
          { Name: "message_id", Value: opts.message_id },
          { Name: "sending_domain_id", Value: pickedDomain.id },
        ],
      });
      externalId = result.external_id;
    } else {
      const result = await deps.outlook.send({
        channel_account_id: account.id,
        draft: opts.draft,
      });
      externalId = result.external_id;
    }

    const sentEvent = await bus.publish({
      workspace_id: opts.workspace_id,
      event_type: "message.sent",
      source: "system",
      producer_ref: `channel:email:${opts.sub_channel}`,
      correlation_id: opts.conversation_id,
      payload: {
        message_id: opts.message_id,
        channel: "email",
        external_id: externalId,
        channel_account_id: account.id,
      },
    });
    await projectMessageLifecycleEvent(pool, sentEvent);
    return {
      status: "sent",
      message_id: opts.message_id,
      external_id: externalId,
      sub_channel: opts.sub_channel,
    };
  } catch (err) {
    await refundSend(pool, account.id);
    const isTransient = isTransientProviderError(err);
    const reason: DeferReason = isTransient
      ? "provider_error_transient"
      : "provider_error_permanent";
    await emitDeferred(
      deps,
      opts,
      reason,
      err instanceof Error ? err.message : String(err),
    );
    return {
      status: "deferred",
      message_id: opts.message_id,
      reason,
      detail: err instanceof Error ? err.message : undefined,
    };
  }
}

async function emitDeferred(
  deps: EmailChannelDeps,
  opts: SendOptions,
  reason: DeferReason,
  detail?: string,
): Promise<void> {
  const event = await deps.bus.publish({
    workspace_id: opts.workspace_id,
    event_type: "message.deferred",
    source: "system",
    producer_ref: `channel:email:${opts.sub_channel}`,
    correlation_id: opts.conversation_id,
    payload: {
      message_id: opts.message_id,
      channel: "email",
      defer_reason: reason,
      retry_after: null,
      detail: detail ?? null,
    },
  });
  await projectMessageLifecycleEvent(deps.pool, event);
}

async function loadConversation(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<ConversationRow | null> {
  const { rows } = await pool.query<ConversationRow>(
    `select workspace_id, counterparty_person_id from conversations
      where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
  return rows[0] ?? null;
}

async function loadChannelAccount(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<ChannelAccountRow | null> {
  const { rows } = await pool.query<ChannelAccountRow>(
    `select id, kind::text as kind, status::text as status, display_name
       from channel_accounts
      where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
  return rows[0] ?? null;
}

async function pickSendingDomain(
  pool: Pool,
  opts: SendOptions,
  account: ChannelAccountRow,
): Promise<SendingDomainPicked | null> {
  const id = opts.sending_domain_id;
  let domain: SendingDomainRow | null = null;
  if (id) {
    domain = await getSendingDomain(pool, opts.workspace_id, id);
  } else {
    const { rows } = await pool.query<{ id: string }>(
      `select id from sending_domains
        where workspace_id = $1
          and channel_account_id = $2
          and warmup_state in ('warming', 'warmed')
        order by warmup_state = 'warmed' desc, current_daily_cap desc
        limit 1`,
      [opts.workspace_id, account.id],
    );
    if (rows[0]) {
      domain = await getSendingDomain(pool, opts.workspace_id, rows[0].id);
    }
  }
  if (!domain) return null;
  return {
    ...domain,
    from_address: deriveFromAddress(account.display_name, domain.domain, opts.draft),
  };
}

function deriveFromAddress(
  accountDisplay: string,
  domain: string,
  draft: EmailDraft,
): string {
  // If the channel_account.display_name looks like a local part (no @),
  // use it as the localpart of the From address. Otherwise default to
  // `hello@<domain>`. Reps with a custom From can pass it via the draft's
  // `reply_to` and we set Reply-To accordingly (already wired in SES).
  void draft;
  const local = accountDisplay.includes("@")
    ? accountDisplay.split("@")[0]
    : accountDisplay.replace(/\s+/g, ".").toLowerCase() || "hello";
  return `${local}@${domain}`;
}

async function countSentTodayForDomain(
  pool: Pool,
  sending_domain_id: string,
): Promise<number> {
  // We track per-account daily_used (via reserveSend); track per-domain
  // separately because one domain can back multiple accounts in future.
  // For foundation, count messages that referenced this domain's account
  // and sent in the last 24h.
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n
       from messages m
      where m.channel = 'email'
        and m.status in ('queued', 'sent', 'delivered')
        and m.channel_account_id in (
          select channel_account_id from sending_domains where id = $1
        )
        and m.sent_at >= now() - interval '24 hours'`,
    [sending_domain_id],
  );
  return Number(rows[0]?.n ?? "0");
}

function isTransientProviderError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; status?: number; $metadata?: { httpStatusCode?: number } };
  if (e.name === "AbortError") return true;
  const status = e.status ?? e.$metadata?.httpStatusCode;
  if (status === undefined) return false;
  return status === 408 || status === 429 || status >= 500;
}

// Re-export the result type for symmetry; helpful at call sites.
export type { SendResult } from "./types.ts";

/**
 * Convenience constructor that wires the SES + Outlook adapters from env.
 * Tests usually call `createEmailChannel({...})` directly with mocks.
 */
export function createDefaultEmailChannel(deps: {
  pool: Pool;
  bus: EventBus;
  ses: SesSender;
  outlook: OutlookSender;
  sesConfigurationSet?: string;
}): ReturnType<typeof createEmailChannel> {
  return createEmailChannel(deps);
}

// Used by `bounces.ts` and tools.ts to label provenance.
export const EMAIL_CHANNEL = "email" as const;
export const EMAIL_SUB_CHANNELS: EmailSubChannel[] = ["owned_domain", "oauth_outlook"];

// Helper to mint a message row for callers that don't already have one
// (kept here rather than baked into sendEmail so the channel stays focused).
export async function createMessageRow(
  pool: Pool,
  args: {
    workspace_id: string;
    conversation_id: string;
    channel: typeof EMAIL_CHANNEL;
    subject: string;
    body_text: string;
    body_html?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into messages (
       id, workspace_id, conversation_id, channel, direction, status,
       subject, body, body_html, created_at
     ) values ($1, $2, $3, $4, 'outbound', 'draft', $5, $6, $7, now())`,
    [
      id,
      args.workspace_id,
      args.conversation_id,
      args.channel,
      args.subject,
      args.body_text,
      args.body_html ?? null,
    ],
  );
  return id;
}
