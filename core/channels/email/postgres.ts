import type { Pool, PoolClient } from "pg";
import type {
  ChannelDraft,
  ChannelSendContext,
  ChannelSendDeferred,
} from "../types.ts";
import type {
  EmailChannel,
  EmailSendEnvelope,
  EmailTransport,
} from "./types.ts";

type DomainWarmupState =
  | "unverified"
  | "verifying"
  | "warming"
  | "warmed"
  | "degraded"
  | "frozen";

interface AccountCandidate {
  id: string;
  display_name: string;
  kind: "email_domain" | "email_oauth";
  status: string;
  daily_cap: number | null;
  daily_used: number;
  daily_window_start: Date | null;
  domain: string | null;
  warmup_state: DomainWarmupState | null;
  current_daily_cap: number | null;
  bounce_rate_24h: string | null;
  complaint_rate_24h: string | null;
}

interface Reservation {
  account_id: string;
  from: string;
}

interface ReservationDecision {
  account?: Reservation;
  defer_reason?: string;
  retry_after?: string | null;
}

interface RecipientFrequencyDecision {
  defer_reason: string;
  retry_after: string;
}

interface StoredMessageSendState {
  status: string;
  external_id: string | null;
  account_id: string | null;
  from_address: string | null;
  send_reserved_at: Date | null;
}

const TRANSPORT_IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

export interface PostgresOwnedDomainEmailChannelOptions {
  pool: Pool;
  transport: EmailTransport;
  now?: () => Date;
  bounceRateLimit?: number;
  complaintRateLimit?: number;
  recipientCooldownMs?: number;
}

function tomorrow(now: Date): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function isFreshWindow(start: Date | null, now: Date): boolean {
  if (!start) return false;
  return now.getTime() - start.getTime() < 24 * 60 * 60 * 1000;
}

function parseRate(value: string | null): number {
  return value == null ? 0 : Number(value);
}

function accountCapacity(row: AccountCandidate): number {
  const accountCap = Math.max(0, row.daily_cap ?? 0);
  if (row.kind !== "email_domain") return accountCap;
  const domainCap = Math.max(0, row.current_daily_cap ?? 0);
  return Math.min(accountCap, domainCap);
}

async function evaluateRecipientFrequency(
  client: PoolClient,
  conversation: {
    workspace_id: string;
    counterparty_person_id: string;
  },
  draft: ChannelDraft,
  now: Date,
  cooldownMs: number,
): Promise<RecipientFrequencyDecision | null> {
  await client.query(
    `select id
       from graph_persons
      where workspace_id = $1
        and id = $2
      for update`,
    [conversation.workspace_id, conversation.counterparty_person_id],
  );
  const cutoff = new Date(now.getTime() - cooldownMs);
  const result = await client.query<{ last_contacted_at: Date }>(
    `select max(m.created_at) as last_contacted_at
       from messages m
       join conversations c
         on c.id = m.conversation_id
        and c.workspace_id = m.workspace_id
      where m.workspace_id = $1
        and c.counterparty_person_id = $2
        and m.id <> $3
        and m.channel = 'email'
        and m.direction = 'outbound'
        and m.status in ('queued', 'sent', 'delivered', 'replied')
        and m.created_at >= $4`,
    [
      conversation.workspace_id,
      conversation.counterparty_person_id,
      draft.message_id,
      cutoff,
    ],
  );
  const lastContactedAt = result.rows[0]?.last_contacted_at;
  if (!lastContactedAt) return null;
  return {
    defer_reason: "recipient_frequency_cap",
    retry_after: new Date(lastContactedAt.getTime() + cooldownMs).toISOString(),
  };
}

async function markMessageQueued(
  client: PoolClient,
  draft: ChannelDraft,
  account_id: string,
  reserved_at: Date,
): Promise<void> {
  await client.query(
    `update messages
        set status = 'queued',
            channel_account_id = $2,
            scheduled_at = null,
            properties = properties || jsonb_build_object('send_reserved_at', $3::timestamptz)
      where id = $1`,
    [draft.message_id, account_id, reserved_at.toISOString()],
  );
}

async function loadMessageSendState(
  client: PoolClient,
  workspace_id: string,
  message_id: string,
): Promise<StoredMessageSendState | null> {
  const { rows } = await client.query<StoredMessageSendState>(
    `select m.status,
            m.external_id,
            ca.id as account_id,
            ca.display_name as from_address,
            case
              when m.properties->>'send_reserved_at' is null then null
              else (m.properties->>'send_reserved_at')::timestamptz
            end as send_reserved_at
       from messages m
       left join channel_accounts ca on ca.id = m.channel_account_id
      where m.id = $1
        and m.workspace_id = $2
      for update of m`,
    [message_id, workspace_id],
  );
  return rows[0] ?? null;
}

function isAlreadySent(state: StoredMessageSendState): boolean {
  return (
    state.external_id !== null &&
    ["sent", "delivered", "bounced", "replied"].includes(state.status)
  );
}

function isSafeTransportRetry(state: StoredMessageSendState, now: Date): boolean {
  return Boolean(
    state.send_reserved_at &&
      now.getTime() - state.send_reserved_at.getTime() <=
        TRANSPORT_IDEMPOTENCY_RETRY_WINDOW_MS,
  );
}

function evaluateAccount(
  row: AccountCandidate,
  now: Date,
  opts: {
    bounceRateLimit: number;
    complaintRateLimit: number;
  },
): ReservationDecision {
  if (row.status !== "connected") return { defer_reason: "channel_account_not_connected" };
  if (row.kind === "email_domain" && !row.domain) {
    return { defer_reason: "sending_domain_missing" };
  }
  if (row.warmup_state === "unverified" || row.warmup_state === "verifying") {
    return { defer_reason: "sending_domain_not_verified" };
  }
  if (row.warmup_state === "frozen") {
    return { defer_reason: "sending_domain_frozen" };
  }
  if (parseRate(row.bounce_rate_24h) >= opts.bounceRateLimit) {
    return { defer_reason: "bounce_rate_throttle", retry_after: tomorrow(now) };
  }
  if (parseRate(row.complaint_rate_24h) >= opts.complaintRateLimit) {
    return { defer_reason: "complaint_rate_throttle", retry_after: tomorrow(now) };
  }

  const used = isFreshWindow(row.daily_window_start, now) ? row.daily_used : 0;
  const cap = accountCapacity(row);
  if (cap <= 0) {
    return { defer_reason: "deliverability_cap_zero", retry_after: tomorrow(now) };
  }
  if (used >= cap) {
    return { defer_reason: "deliverability_cap_exhausted", retry_after: tomorrow(now) };
  }
  return {
    account: {
      account_id: row.id,
      from: row.display_name,
    },
  };
}

async function publishDeferred(
  draft: ChannelDraft,
  ctx: ChannelSendContext,
  defer_reason: string,
  retry_after: string | null,
): Promise<ChannelSendDeferred> {
  await ctx.bus.publish({
    workspace_id: ctx.workspace_id,
    event_type: "message.deferred",
    source: "system",
    producer_ref: ctx.producer_ref ?? "channel:email",
    correlation_id: ctx.correlation_id ?? null,
    idempotency_key: `channel:email:deferred:${draft.message_id}:${defer_reason}`,
    payload: {
      message_id: draft.message_id,
      channel: "email",
      defer_reason,
      retry_after,
    },
  });
  return {
    status: "deferred",
    message_id: draft.message_id,
    defer_reason,
    retry_after,
  };
}

async function reserveAccount(
  client: PoolClient,
  workspace_id: string,
  now: Date,
  opts: {
    bounceRateLimit: number;
    complaintRateLimit: number;
  },
): Promise<ReservationDecision> {
  const { rows } = await client.query<AccountCandidate>(
    `select ca.id,
            ca.display_name,
            ca.kind,
            ca.status,
            ca.daily_cap,
            ca.daily_used,
            ca.daily_window_start,
            sd.domain::text as domain,
            sd.warmup_state,
            sd.current_daily_cap,
            sd.bounce_rate_24h::text as bounce_rate_24h,
            sd.complaint_rate_24h::text as complaint_rate_24h
       from channel_accounts ca
       left join sending_domains sd
         on sd.channel_account_id = ca.id
      where ca.workspace_id = $1
        and ca.kind in ('email_domain', 'email_oauth')
      order by ca.last_used_at nulls first, ca.created_at asc
      for update of ca`,
    [workspace_id],
  );

  let fallback: ReservationDecision = { defer_reason: "no_connected_email_account" };
  for (const row of rows) {
    const decision = evaluateAccount(row, now, opts);
    if (!decision.account) {
      if (fallback.defer_reason === "no_connected_email_account") {
        fallback = decision;
      }
      continue;
    }

    await client.query(
      `update channel_accounts
          set daily_used = case
                when daily_window_start is null
                  or daily_window_start < now() - interval '24 hours'
                then 1
                else daily_used + 1
              end,
              daily_window_start = case
                when daily_window_start is null
                  or daily_window_start < now() - interval '24 hours'
                then now()
                else daily_window_start
              end,
              last_used_at = now(),
              last_error = null
        where id = $1`,
      [decision.account.account_id],
    );
    return decision;
  }
  return fallback;
}

export function createPostgresOwnedDomainEmailChannel(
  opts: PostgresOwnedDomainEmailChannelOptions,
): EmailChannel {
  const now = opts.now ?? (() => new Date());
  const bounceRateLimit = opts.bounceRateLimit ?? 0.05;
  const complaintRateLimit = opts.complaintRateLimit ?? 0.01;
  const recipientCooldownMs = opts.recipientCooldownMs ?? 7 * 24 * 60 * 60 * 1000;

  return {
    name: "email",

    async send(conversation, draft, ctx) {
      if (!draft.eval_passed) {
        return publishDeferred(draft, ctx, "eval_not_passed", null);
      }
      if (!conversation.counterparty_email) {
        return publishDeferred(draft, ctx, "missing_recipient_email", null);
      }

      const client = await opts.pool.connect();
      let reservation: ReservationDecision;
      let alreadySentExternalId: string | null = null;
      try {
        await client.query("begin");
        const nowDate = now();
        const existing = await loadMessageSendState(
          client,
          conversation.workspace_id,
          draft.message_id,
        );
        if (existing && isAlreadySent(existing)) {
          alreadySentExternalId = existing.external_id;
          reservation = {};
        } else if (
          existing?.status === "queued" &&
          existing.account_id &&
          existing.from_address
        ) {
          reservation = isSafeTransportRetry(existing, nowDate)
            ? {
                account: {
                  account_id: existing.account_id,
                  from: existing.from_address,
                },
              }
            : {
                defer_reason: "transport_idempotency_window_expired",
                retry_after: null,
              };
        } else {
          const recipientFrequency = await evaluateRecipientFrequency(
            client,
            conversation,
            draft,
            nowDate,
            recipientCooldownMs,
          );
          if (recipientFrequency) {
            reservation = recipientFrequency;
          } else {
            reservation = await reserveAccount(client, conversation.workspace_id, nowDate, {
              bounceRateLimit,
              complaintRateLimit,
            });
          }
          if (reservation.account) {
            await markMessageQueued(
              client,
              draft,
              reservation.account.account_id,
              nowDate,
            );
          }
        }
        await client.query("commit");
      } catch (err) {
        try {
          await client.query("rollback");
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }

      if (alreadySentExternalId) {
        return {
          status: "sent",
          message_id: draft.message_id,
          external_id: alreadySentExternalId,
        };
      }

      if (!reservation.account) {
        return publishDeferred(
          draft,
          ctx,
          reservation.defer_reason ?? "no_connected_email_account",
          reservation.retry_after ?? null,
        );
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

      const envelope: EmailSendEnvelope = {
        from: reservation.account.from,
        to: conversation.counterparty_email,
        subject: draft.subject ?? "",
        body: draft.body,
        account_id: reservation.account.account_id,
        idempotency_key: `message/${draft.message_id}`,
      };

      try {
        const result = await opts.transport.send(envelope);
        await opts.pool.query(
          `update messages
              set channel_account_id = $2
            where id = $1`,
          [draft.message_id, reservation.account.account_id],
        );
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await opts.pool.query(
          `update channel_accounts
              set last_error = $2::jsonb
            where id = $1`,
          [
            reservation.account.account_id,
            JSON.stringify({ message, at: now().toISOString() }),
          ],
        );
        await ctx.bus.publish({
          workspace_id: ctx.workspace_id,
          event_type: "channel.account.errored",
          source: "system",
          producer_ref: ctx.producer_ref ?? "channel:email",
          correlation_id: ctx.correlation_id ?? null,
          payload: {
            channel_account_id: reservation.account.account_id,
            kind: "email",
            error: message,
          },
        });
        throw err;
      }
    },
  };
}
