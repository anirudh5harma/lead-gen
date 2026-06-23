import type { Pool } from "pg";
import type {
  EventBus,
  EventHandler,
  EventPayload,
  Subscription,
} from "../../substrate/events/index.ts";
import { decryptCredentials } from "../../substrate/auth/index.ts";
import type { RepMemory } from "../../agents/memory/index.ts";
import type { IntentClassifier } from "./intent.ts";
import type { OutlookAccessTokenProvider } from "./adapters/outlook.ts";
import { handleBounce } from "./bounces.ts";
import { handleInboundEmail, type InboundEmail } from "./reply.ts";
import { fetchOutlookMessage, graphMessageToInbound } from "./outlook-subscription.ts";

type EmailIngressType =
  | "email.bounce.received"
  | "email.inbound.received"
  | "email.outlook.notification.received"
  | "email.outlook.authorization.received"
  | "email.outlook.credentials.refreshed"
  | "email.outlook.reauthorization.required";

export interface OutlookSubscriptionRepairStarter {
  start(input: { workspace_id: string; channel_account_id: string }): Promise<void>;
}

export interface EmailIngressProjectorDeps {
  pool: Pool;
  bus: EventBus;
  classifier: IntentClassifier;
  memory?: RepMemory;
  fetchImpl?: typeof fetch;
  outlookAccessTokens?: OutlookAccessTokenProvider;
  outlookSubscriptionRepair?: OutlookSubscriptionRepairStarter;
}

export interface EmailIngressSubscriber {
  subscribe<T extends EmailIngressType>(
    eventType: T,
    handler: EventHandler<EventPayload<T>>,
    durableName: string,
  ): Promise<Subscription>;
}

/**
 * Materializes authenticated provider ingress and Outlook credential lifecycle
 * events. Surface routes and provider adapters publish events only; this
 * consumer owns channel state mutation and resulting domain events.
 */
export async function registerEmailIngressProjectors(
  deps: EmailIngressProjectorDeps,
  subscriber: EmailIngressSubscriber = defaultSubscriber(deps.bus),
): Promise<Subscription[]> {
  return Promise.all([
    subscriber.subscribe(
      "email.bounce.received",
      async (event) => {
        await handleBounce(deps.pool, deps.bus, {
          workspace_id: event.workspace_id,
          ...event.payload,
        }, { ingress_event_id: event.id });
      },
      "email_bounce_projector",
    ),
    subscriber.subscribe(
      "email.inbound.received",
      async (event) => {
        await handleInboundEmail(
          {
            pool: deps.pool,
            bus: deps.bus,
            classifier: deps.classifier,
            memory: deps.memory,
            ingress_event_id: event.id,
          },
          { workspace_id: event.workspace_id, ...event.payload },
        );
      },
      "email_inbound_projector",
    ),
    subscriber.subscribe(
      "email.outlook.notification.received",
      async (event) => {
        const inbound = await fetchInboundFromOutlookNotification(
          deps.pool,
          event.workspace_id,
          event.payload.channel_account_id,
          event.payload.resource_id,
          deps.outlookAccessTokens,
          deps.fetchImpl,
        );
        if (!inbound) return;
        await handleInboundEmail(
          {
            pool: deps.pool,
            bus: deps.bus,
            classifier: deps.classifier,
            memory: deps.memory,
            ingress_event_id: event.id,
          },
          inbound,
        );
      },
      "email_outlook_notification_projector",
    ),
    subscriber.subscribe(
      "email.outlook.authorization.received",
      async (event) => {
        await projectOutlookAuthorization(deps.pool, event.workspace_id, event.payload);
        await deps.bus.publish({
          workspace_id: event.workspace_id,
          event_type: "channel.account.connected",
          source: "system",
          producer_ref: "projection:email.outlook.authorization.received",
          causation_id: event.id,
          correlation_id: event.correlation_id ?? event.id,
          idempotency_key: `projection:${event.id}:channel.account.connected`,
          payload: {
            channel_account_id: event.payload.channel_account_id,
            kind: "oauth_outlook",
          },
        });
        await deps.outlookSubscriptionRepair?.start({
          workspace_id: event.workspace_id,
          channel_account_id: event.payload.channel_account_id,
        });
      },
      "email_outlook_authorization_projector",
    ),
    subscriber.subscribe(
      "email.outlook.credentials.refreshed",
      async (event) => {
        await projectOutlookCredentialsRefreshed(
          deps.pool,
          event.workspace_id,
          event.payload,
        );
      },
      "email_outlook_credentials_refreshed_projector",
    ),
    subscriber.subscribe(
      "email.outlook.reauthorization.required",
      async (event) => {
        await projectOutlookReauthorizationRequired(
          deps.pool,
          event.workspace_id,
          event.payload,
        );
      },
      "email_outlook_reauthorization_required_projector",
    ),
  ]);
}

function defaultSubscriber(bus: EventBus): EmailIngressSubscriber {
  return {
    subscribe<T extends EmailIngressType>(
      eventType: T,
      handler: EventHandler<EventPayload<T>>,
    ) {
      return bus.subscribe(eventType, handler);
    },
  };
}

async function fetchInboundFromOutlookNotification(
  pool: Pool,
  workspaceId: string,
  channelAccountId: string,
  resourceId: string,
  accessTokens?: OutlookAccessTokenProvider,
  fetchImpl?: typeof fetch,
): Promise<InboundEmail | null> {
  if (accessTokens) {
    const accessToken = await accessTokens.getAccessToken(channelAccountId);
    const message = await fetchOutlookMessage({
      accessToken,
      messageId: resourceId,
      fetchImpl,
    });
    return graphMessageToInbound(message, workspaceId, channelAccountId);
  }
  const { rows } = await pool.query<{ credentials: unknown }>(
    `select credentials
       from channel_accounts
      where workspace_id = $1 and id = $2 and kind = 'oauth_outlook'
      limit 1`,
    [workspaceId, channelAccountId],
  );
  const row = rows[0];
  if (!row) return null;
  const credentials = decryptCredentials<{ access_token?: string }>(
    row.credentials,
    { workspace_id: workspaceId, channel_account_id: channelAccountId },
  );
  if (!credentials.access_token) return null;
  const message = await fetchOutlookMessage({
    accessToken: credentials.access_token,
    messageId: resourceId,
    fetchImpl,
  });
  return graphMessageToInbound(message, workspaceId, channelAccountId);
}

export async function projectOutlookAuthorization(
  pool: Pool,
  workspaceId: string,
  payload: EventPayload<"email.outlook.authorization.received">,
): Promise<void> {
  const properties: Record<string, string> = {
    ms_user_id: payload.ms_user_id,
  };
  if (payload.mailbox_email?.trim()) {
    properties.mailbox_email = payload.mailbox_email.trim().toLowerCase();
  }
  const result = await pool.query(
    `insert into channel_accounts (
       id, workspace_id, user_id, kind, display_name, status,
       daily_cap, credentials, properties
     ) values (
       $1, $2, $3, 'oauth_outlook', $4, 'connected',
       $5, $6::jsonb, $7::jsonb
     )
     on conflict (id) do update set
       user_id = excluded.user_id,
       display_name = excluded.display_name,
       status = 'connected',
       daily_cap = excluded.daily_cap,
       credentials = excluded.credentials,
       properties = channel_accounts.properties || excluded.properties,
       last_error = null,
       updated_at = now()
     where channel_accounts.workspace_id = excluded.workspace_id
       and channel_accounts.kind = 'oauth_outlook'
     returning id`,
    [
      payload.channel_account_id,
      workspaceId,
      payload.user_id ?? null,
      payload.display_name,
      payload.daily_cap,
      JSON.stringify(payload.encrypted_credentials),
      JSON.stringify(properties),
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Outlook authorization projection rejected account ${payload.channel_account_id}`,
    );
  }
}

export async function projectOutlookCredentialsRefreshed(
  pool: Pool,
  workspaceId: string,
  payload: EventPayload<"email.outlook.credentials.refreshed">,
): Promise<void> {
  const result = await pool.query(
    `update channel_accounts
        set credentials = $3::jsonb,
            status = 'connected',
            last_error = null,
            updated_at = now()
      where workspace_id = $1
        and id = $2
        and kind = 'oauth_outlook'`,
    [
      workspaceId,
      payload.channel_account_id,
      JSON.stringify(payload.encrypted_credentials),
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Outlook credential refresh projection rejected account ${payload.channel_account_id}`,
    );
  }
}

export async function projectOutlookReauthorizationRequired(
  pool: Pool,
  workspaceId: string,
  payload: EventPayload<"email.outlook.reauthorization.required">,
): Promise<void> {
  const result = await pool.query(
    `update channel_accounts
        set status = 'needs_reauth',
            last_error = $3::jsonb,
            updated_at = now()
      where workspace_id = $1
        and id = $2
        and kind = 'oauth_outlook'`,
    [
      workspaceId,
      payload.channel_account_id,
      JSON.stringify({ message: payload.error }),
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Outlook reauthorization projection rejected account ${payload.channel_account_id}`,
    );
  }
}
