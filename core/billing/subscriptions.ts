import type { Pool } from "pg";
import type { EventBus, EventPayload, PublishedEvent } from "../substrate/events/index.ts";
import {
  dodoPeriodForProductId,
  isConfiguredProProductId,
  type DodoProBillingPeriod,
} from "./dodo.ts";

export type WorkspaceBillingSubscriptionStatus =
  | "active"
  | "canceled"
  | "expired"
  | "inactive";

export interface DodoWebhookPayload {
  type: string;
  data: DodoSubscriptionWebhookData;
  timestamp?: string;
  business_id?: string;
}

export interface DodoSubscriptionWebhookData {
  subscription_id?: string | null;
  product_id?: string | null;
  status?: string | null;
  next_billing_date?: string | null;
  previous_billing_date?: string | null;
  current_period_start?: string | null;
  billing_period_start?: string | null;
  period_start?: string | null;
  cancelled_at?: string | null;
  expires_at?: string | null;
  customer?: {
    customer_id?: string | null;
    email?: string | null;
  } | null;
  metadata?: Record<string, string> | null;
}

export interface HandleDodoWebhookEventResult {
  handled: boolean;
  reason?: string;
  event?: PublishedEvent<EventPayload<"workspace.billing.subscription.synced">>;
}

const ACTIVATION_EVENTS = new Set([
  "subscription.active",
  "subscription.created",
  "subscription.renewed",
]);

const DEACTIVATION_EVENTS = new Set([
  "subscription.cancelled",
  "subscription.expired",
]);

export async function handleDodoWebhookEvent(
  pool: Pool,
  bus: Pick<EventBus, "publish">,
  payload: DodoWebhookPayload,
  opts: { webhookId?: string | null } = {},
): Promise<HandleDodoWebhookEventResult> {
  const eventType = payload.type;
  const status = statusForDodoEvent(eventType);
  if (!status) return { handled: false, reason: "irrelevant_event" };

  const data = payload.data;
  const metadata = data.metadata ?? {};
  const productId = data.product_id ?? null;
  const period = resolvePeriod(metadata, productId, data);
  const isPro =
    metadata.plan === "pro" ||
    metadata.tier === "pro" ||
    isConfiguredProProductId(productId);
  if (!isPro) return { handled: false, reason: "non_pro_subscription" };

  const workspaceId = await resolveWorkspaceId(pool, {
    metadata,
    subscriptionId: data.subscription_id ?? null,
    customerId: data.customer?.customer_id ?? null,
  });
  if (!workspaceId) return { handled: false, reason: "workspace_not_found" };

  const event = await bus.publish({
    workspace_id: workspaceId,
    event_type: "workspace.billing.subscription.synced",
    source: "webhook",
    producer_ref: "webhook:dodo",
    idempotency_key: dodoWebhookIdempotencyKey(payload, opts.webhookId),
    occurred_at: payload.timestamp,
    payload: {
      workspace_id: workspaceId,
      provider: "dodo",
      plan: status === "active" ? "pro" : "free",
      status,
      period: status === "active" ? period : null,
      provider_customer_id: data.customer?.customer_id ?? null,
      provider_subscription_id: data.subscription_id ?? null,
      provider_product_id: productId,
      current_period_start_at:
        status === "active" ? resolveCurrentPeriodStart(data) : null,
      renews_at: status === "active" ? data.next_billing_date ?? null : null,
      canceled_at:
        status === "active"
          ? null
          : data.cancelled_at ?? data.expires_at ?? null,
      webhook_event_type: eventType,
      raw_status: data.status ?? null,
    },
  });

  await projectWorkspaceBillingSubscriptionSynced(pool, event);
  return { handled: true, event };
}

export async function projectWorkspaceBillingSubscriptionSynced(
  pool: Pool,
  event: PublishedEvent<EventPayload<"workspace.billing.subscription.synced">>,
): Promise<void> {
  const p = event.payload;
  await pool.query(
    `update workspaces
        set plan = $2,
            subscription_status = $3,
            subscription_period = $4,
            subscription_external_id = coalesce($5, subscription_external_id),
            subscription_product_id = coalesce($6, subscription_product_id),
            dodo_customer_id = coalesce($7, dodo_customer_id),
            subscription_current_period_start_at = $8,
            subscription_renews_at = $9,
            subscription_cancelled_at = $10,
            subscription_updated_at = coalesce($11::timestamptz, now())
      where id = $1`,
    [
      p.workspace_id,
      p.plan,
      p.status,
      p.period,
      p.provider_subscription_id,
      p.provider_product_id,
      p.provider_customer_id,
      p.current_period_start_at,
      p.renews_at,
      p.canceled_at,
      event.occurred_at,
    ],
  );
}

function statusForDodoEvent(
  eventType: string,
): WorkspaceBillingSubscriptionStatus | null {
  if (ACTIVATION_EVENTS.has(eventType)) return "active";
  if (eventType === "subscription.cancelled") return "canceled";
  if (eventType === "subscription.expired") return "expired";
  return null;
}

function resolvePeriod(
  metadata: Record<string, string>,
  productId: string | null,
  data: DodoSubscriptionWebhookData,
): DodoProBillingPeriod {
  if (metadata.period === "annual" || metadata.period === "monthly") {
    return metadata.period;
  }
  const productPeriod = dodoPeriodForProductId(productId);
  if (productPeriod) return productPeriod;
  return data.status?.includes("annual") ? "annual" : "monthly";
}

function resolveCurrentPeriodStart(
  data: DodoSubscriptionWebhookData,
): string | null {
  return data.current_period_start ??
    data.billing_period_start ??
    data.period_start ??
    data.previous_billing_date ??
    null;
}

async function resolveWorkspaceId(
  pool: Pool,
  input: {
    metadata: Record<string, string>;
    subscriptionId: string | null;
    customerId: string | null;
  },
): Promise<string | null> {
  const metadataWorkspaceId = input.metadata.workspace_id;
  if (metadataWorkspaceId) return metadataWorkspaceId;

  if (input.subscriptionId) {
    const { rows } = await pool.query<{ id: string }>(
      `select id
         from workspaces
        where subscription_external_id = $1
        limit 1`,
      [input.subscriptionId],
    );
    if (rows[0]) return rows[0].id;
  }

  if (input.customerId) {
    const { rows } = await pool.query<{ id: string }>(
      `select id
         from workspaces
        where dodo_customer_id = $1
        order by created_at asc
        limit 1`,
      [input.customerId],
    );
    if (rows[0]) return rows[0].id;
  }

  const userId = input.metadata.user_id;
  if (userId) {
    const { rows } = await pool.query<{ id: string }>(
      `select w.id
         from workspaces w
         join workspace_members wm on wm.workspace_id = w.id
        where wm.user_id = $1
          and wm.accepted_at is not null
          and w.archived_at is null
        order by w.created_at asc
        limit 1`,
      [userId],
    );
    if (rows[0]) return rows[0].id;
  }

  return null;
}

function dodoWebhookIdempotencyKey(
  payload: DodoWebhookPayload,
  webhookId?: string | null,
): string {
  const subscriptionId = payload.data.subscription_id ?? "unknown_subscription";
  return webhookId
    ? `dodo:${webhookId}`
    : `dodo:${payload.type}:${subscriptionId}:${payload.timestamp ?? "unknown_time"}`;
}
