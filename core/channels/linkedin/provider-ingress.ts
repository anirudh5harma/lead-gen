import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventBus,
  EventPayload,
  PublishedEvent,
} from "../../substrate/events/index.ts";

export const LINKEDIN_PROVIDER_AUTHORIZATION_PROJECTION =
  "linkedin.provider_authorization.v1";

type LinkedInAuthorizationEvent = PublishedEvent<
  EventPayload<"linkedin.account.authorization.received">
>;

export function createLinkedInProviderAuthorizationProjection(opts: {
  pool: Pool;
  bus: EventBus;
}): DurableEventProjection {
  return {
    name: LINKEDIN_PROVIDER_AUTHORIZATION_PROJECTION,
    eventTypes: ["linkedin.account.authorization.received"],
    apply: (event) =>
      projectLinkedInProviderAuthorization(
        opts.pool,
        opts.bus,
        event as LinkedInAuthorizationEvent,
      ),
  };
}

export async function projectLinkedInProviderAuthorization(
  pool: Pool,
  bus: Pick<EventBus, "publish">,
  event: LinkedInAuthorizationEvent,
): Promise<void> {
  const payload = event.payload;
  const properties = {
    ...(payload.properties ?? {}),
    provider: "linkedin",
    provider_account_id: payload.provider_account_id,
    ...(payload.profile_url ? { profile_url: payload.profile_url } : {}),
    authorized_event_id: event.id,
  };

  const result = await pool.query(
    `insert into channel_accounts (
       id, workspace_id, user_id, kind, display_name, status, daily_cap, daily_used, properties
     ) values ($1, $2, $3, $4::channel_account_kind, $5, 'connected', $6, 0, $7::jsonb)
     on conflict (id) do update
       set user_id = excluded.user_id,
           display_name = excluded.display_name,
           status = 'connected',
           last_error = null,
           daily_cap = coalesce(excluded.daily_cap, channel_accounts.daily_cap),
           properties = channel_accounts.properties || excluded.properties
     where channel_accounts.workspace_id = excluded.workspace_id
       and channel_accounts.kind in ('linkedin_session', 'linkedin_oauth')`,
    [
      payload.channel_account_id,
      event.workspace_id,
      payload.user_id ?? null,
      payload.kind,
      payload.display_name,
      payload.daily_cap ?? null,
      JSON.stringify(properties),
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `LinkedIn authorization projection rejected account ${payload.channel_account_id}`,
    );
  }

  await bus.publish({
    workspace_id: event.workspace_id,
    event_type: "channel.account.connected",
    source: "system",
    producer_ref: "projection:linkedin.account.authorization.received",
    correlation_id: event.correlation_id ?? event.id,
    causation_id: event.id,
    idempotency_key: `projection:${event.id}:channel.account.connected`,
    payload: {
      channel_account_id: payload.channel_account_id,
      kind: payload.kind,
    },
  });
}
