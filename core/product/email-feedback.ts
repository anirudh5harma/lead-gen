import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventBus,
  PublishedEvent,
} from "../substrate/events/index.ts";
import { projectMessageLifecycleEvent } from "../channels/message-lifecycle.ts";
import { projectOutcomeLifecycleEvent } from "../primitives/outcome-lifecycle.ts";

export const EMAIL_DELIVERY_FEEDBACK_PROJECTION = "channel.email_feedback.v1";

const ResendEmailWebhook = z.object({
  type: z.string(),
  created_at: z.string().datetime().optional(),
  data: z.object({
    email_id: z.string().min(1),
    bounce: z
      .object({
        type: z.string().optional(),
        subType: z.string().optional(),
        message: z.string().optional(),
      })
      .optional(),
  }),
});

const MessageDeliveredPayload = z.object({
  message_id: z.string().uuid(),
  channel: z.literal("email"),
  external_id: z.string().nullable().optional(),
  provider_event_id: z.string().nullable().optional(),
});

const MessageBouncedPayload = z.object({
  message_id: z.string().uuid(),
  channel: z.literal("email"),
  bounce_type: z.enum(["hard", "soft", "complaint"]),
  external_id: z.string().nullable().optional(),
  provider_event_id: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  recipient: z.string().email().nullable().optional(),
  detail: z.string().nullable().optional(),
});

export type ResendWebhookAction =
  | {
      action: "delivered";
      external_id: string;
      occurred_at: string | null;
    }
  | {
      action: "bounced";
      external_id: string;
      bounce_type: "hard" | "soft" | "complaint";
      reason: string | null;
      occurred_at: string | null;
    };

export interface PublishResendWebhookResult {
  status: "published" | "ignored";
  message_id?: string;
  event_type?: "message.delivered" | "message.bounced";
  event_id?: string;
  reason?: string;
}

export interface EmailFeedbackProjection {
  unsubscribe(): Promise<void>;
}

export function normalizeResendEmailWebhook(payload: unknown): ResendWebhookAction | null {
  const event = ResendEmailWebhook.parse(payload);
  const occurred_at = event.created_at ?? null;
  if (event.type === "email.delivered") {
    return {
      action: "delivered",
      external_id: event.data.email_id,
      occurred_at,
    };
  }
  if (event.type === "email.complained") {
    return {
      action: "bounced",
      external_id: event.data.email_id,
      bounce_type: "complaint",
      reason: "recipient_marked_spam",
      occurred_at,
    };
  }
  if (event.type === "email.bounced") {
    return {
      action: "bounced",
      external_id: event.data.email_id,
      bounce_type: event.data.bounce?.type === "Permanent" ? "hard" : "soft",
      reason: event.data.bounce?.message ?? event.data.bounce?.subType ?? null,
      occurred_at,
    };
  }
  if (event.type === "email.delivery_delayed") {
    return {
      action: "bounced",
      external_id: event.data.email_id,
      bounce_type: "soft",
      reason: "delivery_delayed",
      occurred_at,
    };
  }
  if (event.type === "email.failed" || event.type === "email.suppressed") {
    return {
      action: "bounced",
      external_id: event.data.email_id,
      bounce_type: "hard",
      reason: event.type,
      occurred_at,
    };
  }
  return null;
}

export async function publishResendEmailWebhook(
  pool: Pool,
  bus: EventBus,
  payload: unknown,
  opts: {
    providerEventId?: string | null;
  } = {},
): Promise<PublishResendWebhookResult> {
  const action = normalizeResendEmailWebhook(payload);
  if (!action) return { status: "ignored", reason: "unsupported_event_type" };

  const { rows } = await pool.query<{
    id: string;
    workspace_id: string;
  }>(
    `select id, workspace_id
       from messages
      where channel = 'email'
        and direction = 'outbound'
        and external_id = $1
      order by created_at desc
      limit 1`,
    [action.external_id],
  );
  const message = rows[0];
  if (!message) {
    return { status: "ignored", reason: "message_not_found" };
  }

  const idempotency_key = opts.providerEventId
    ? `webhook:resend:${opts.providerEventId}`
    : undefined;

  if (action.action === "delivered") {
    const event = await bus.publish({
      workspace_id: message.workspace_id,
      event_type: "message.delivered",
      source: "webhook",
      producer_ref: "webhook:resend",
      idempotency_key,
      occurred_at: action.occurred_at ?? undefined,
      payload: {
        message_id: message.id,
        channel: "email",
        external_id: action.external_id,
        provider_event_id: opts.providerEventId ?? null,
      },
    });
    return {
      status: "published",
      message_id: message.id,
      event_type: "message.delivered",
      event_id: event.id,
    };
  }

  const event = await bus.publish({
    workspace_id: message.workspace_id,
    event_type: "message.bounced",
    source: "webhook",
    producer_ref: "webhook:resend",
    idempotency_key,
    occurred_at: action.occurred_at ?? undefined,
    payload: {
      message_id: message.id,
      channel: "email",
      bounce_type: action.bounce_type,
      external_id: action.external_id,
      provider_event_id: opts.providerEventId ?? null,
      reason: action.reason,
    },
  });
  return {
    status: "published",
    message_id: message.id,
    event_type: "message.bounced",
    event_id: event.id,
  };
}

export async function wireEmailDeliveryFeedback(
  opts: {
    pool: Pool;
    bus: EventBus;
  },
): Promise<EmailFeedbackProjection> {
  const projection = createEmailDeliveryFeedbackProjection(opts);
  const delivered = await opts.bus.subscribe("message.delivered", projection.apply);
  const bounced = await opts.bus.subscribe("message.bounced", projection.apply);
  return {
    async unsubscribe() {
      await delivered.unsubscribe();
      await bounced.unsubscribe();
    },
  };
}

export function createEmailDeliveryFeedbackProjection(
  opts: {
    pool: Pool;
    bus: EventBus;
  },
): DurableEventProjection {
  return {
    name: EMAIL_DELIVERY_FEEDBACK_PROJECTION,
    eventTypes: ["message.delivered", "message.bounced"],
    async apply(event) {
      if (event.event_type === "message.delivered") {
        await applyMessageDelivered(opts.pool, event);
      } else if (event.event_type === "message.bounced") {
        await applyMessageBounced(opts.pool, opts.bus, event);
      }
    },
  };
}

async function applyMessageDelivered(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  const payload = MessageDeliveredPayload.parse(event.payload);
  await projectMessageLifecycleEvent(pool, event);
  const { rows } = await pool.query<{ channel_account_id: string | null }>(
    `select channel_account_id
       from messages
      where id = $1
        and workspace_id = $2
        and channel = 'email'
        and direction = 'outbound'
      limit 1`,
    [payload.message_id, event.workspace_id],
  );
  const accountId = rows[0]?.channel_account_id;
  if (accountId) {
    await refreshSendingDomainRates(pool, accountId);
  }
}

async function applyMessageBounced(
  pool: Pool,
  bus: EventBus,
  event: PublishedEvent,
): Promise<void> {
  const payload = MessageBouncedPayload.parse(event.payload);
  await projectMessageLifecycleEvent(pool, event);
  const { rows } = await pool.query<{
    channel_account_id: string | null;
    conversation_id: string | null;
    rep_id: string | null;
  }>(
    `select m.channel_account_id,
            m.conversation_id,
            c.rep_id
       from messages m
       left join conversations c
         on c.id = m.conversation_id
        and c.workspace_id = m.workspace_id
      where m.id = $1
        and m.workspace_id = $2
        and m.channel = 'email'
        and m.direction = 'outbound'
      limit 1`,
    [payload.message_id, event.workspace_id],
  );
  const row = rows[0];
  if (!row) return;
  if (row.channel_account_id) {
    await refreshSendingDomainRates(pool, row.channel_account_id);
  }

  const outcomeProperties = {
    bounce_type: payload.bounce_type,
    reason: payload.reason ?? null,
    bounce_event_id: event.id,
    delivery_external_id: payload.external_id ?? null,
  };
  const outcomeRecorded = await bus.publish({
    workspace_id: event.workspace_id,
    event_type: "outcome.recorded",
    source: "system",
    producer_ref: "projector:email-feedback",
    correlation_id: event.correlation_id,
    causation_id: event.id,
    idempotency_key: `projection:message:${payload.message_id}:outcome.recorded:bounce`,
    payload: {
      outcome_id: randomUUID(),
      kind: "bounce",
      score: payload.bounce_type === "complaint" ? -1 : -0.2,
      conversation_id: row.conversation_id,
      attributed_play_id: null,
      attributed_message_id: payload.message_id,
      attributed_rep_id: row.rep_id,
      properties: outcomeProperties,
      provenance: { source: "email-feedback" },
      occurred_at: event.occurred_at,
    },
  });
  await projectOutcomeLifecycleEvent(pool, outcomeRecorded);
}

async function refreshSendingDomainRates(
  pool: Pool,
  channel_account_id: string,
): Promise<void> {
  await pool.query(
    `with totals as (
       select count(*)::numeric as total
         from messages
        where channel_account_id = $1
          and channel = 'email'
          and direction = 'outbound'
          and sent_at >= now() - interval '24 hours'
          and status in ('sent', 'delivered', 'bounced', 'replied')
     ),
     bounces as (
       select count(*)::numeric as total
         from messages
        where channel_account_id = $1
          and channel = 'email'
          and direction = 'outbound'
          and sent_at >= now() - interval '24 hours'
          and status = 'bounced'
     ),
     complaints as (
       select count(*)::numeric as total
         from events e
         join messages m
           on m.id = (e.payload->>'message_id')::uuid
        where m.channel_account_id = $1
          and e.event_type = 'message.bounced'
          and e.payload->>'bounce_type' = 'complaint'
          and e.occurred_at >= now() - interval '24 hours'
     ),
     rates as (
       select case when totals.total = 0 then 0 else bounces.total / totals.total end as bounce_rate,
              case when totals.total = 0 then 0 else complaints.total / totals.total end as complaint_rate
         from totals, bounces, complaints
     )
     update sending_domains sd
        set bounce_rate_24h = rates.bounce_rate,
            complaint_rate_24h = rates.complaint_rate,
            warmup_state = case
              when rates.complaint_rate >= 0.01 or rates.bounce_rate >= 0.05 then 'frozen'::domain_warmup_state
              when rates.complaint_rate > 0 or rates.bounce_rate > 0 then 'degraded'::domain_warmup_state
              else sd.warmup_state
            end,
            updated_at = now()
       from rates
      where sd.channel_account_id = $1`,
    [channel_account_id],
  );
}
