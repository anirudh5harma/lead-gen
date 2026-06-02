import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";

export const CHANNEL_ACCOUNT_LIFECYCLE_PROJECTION =
  "channel.account_lifecycle.v1";

type ChannelAccountLifecycleEvent =
  | PublishedEvent<EventPayload<"channel.account.connected">>
  | PublishedEvent<EventPayload<"channel.account.errored">>;

export function createChannelAccountLifecycleProjection(
  pool: Pool,
): DurableEventProjection {
  return {
    name: CHANNEL_ACCOUNT_LIFECYCLE_PROJECTION,
    eventTypes: ["channel.account.connected", "channel.account.errored"],
    apply: (event) => projectChannelAccountLifecycleEvent(pool, event),
  };
}

export async function projectChannelAccountLifecycleEvent(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  if (event.event_type === "channel.account.connected") {
    await projectChannelAccountConnected(
      pool,
      event as ChannelAccountLifecycleEvent &
        PublishedEvent<EventPayload<"channel.account.connected">>,
    );
  } else if (event.event_type === "channel.account.errored") {
    await projectChannelAccountErrored(
      pool,
      event as ChannelAccountLifecycleEvent &
        PublishedEvent<EventPayload<"channel.account.errored">>,
    );
  }
}

async function projectChannelAccountConnected(
  pool: Pool,
  event: ChannelAccountLifecycleEvent &
    PublishedEvent<EventPayload<"channel.account.connected">>,
): Promise<void> {
  const payload = event.payload;
  const result = await pool.query(
    `update channel_accounts
        set status = 'connected',
            last_error = null,
            display_name = coalesce($4, display_name),
            properties = properties || $5::jsonb
      where workspace_id = $1
        and id = $2
        and kind::text = $3`,
    [
      event.workspace_id,
      payload.channel_account_id,
      payload.kind,
      payload.account_display_name ?? null,
      JSON.stringify({
        connected_event_id: event.id,
        provider_account_id: payload.provider_account_id,
        provider_event_id: payload.provider_event_id,
      }),
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Channel account connected projection rejected account ${payload.channel_account_id}`,
    );
  }
}

async function projectChannelAccountErrored(
  pool: Pool,
  event: ChannelAccountLifecycleEvent &
    PublishedEvent<EventPayload<"channel.account.errored">>,
): Promise<void> {
  const payload = event.payload;
  const status = payload.status ?? null;
  const provider = {
    provider_account_id: payload.provider_account_id,
    provider_event_id: payload.provider_event_id,
    provider_incident_id: payload.provider_incident_id,
    retry_after: payload.retry_after,
  };
  const result = await pool.query(
    `update channel_accounts
        set status = coalesce($4::channel_account_status, status),
            display_name = coalesce($5, display_name),
            last_error = $6::jsonb,
            properties = properties || $7::jsonb
      where workspace_id = $1
        and id = $2
        and kind::text = $3`,
    [
      event.workspace_id,
      payload.channel_account_id,
      payload.kind,
      status,
      payload.account_display_name ?? null,
      JSON.stringify({
        message: payload.error,
        at: event.occurred_at,
        ...provider,
      }),
      JSON.stringify({
        errored_event_id: event.id,
        ...provider,
      }),
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Channel account error projection rejected account ${payload.channel_account_id}`,
    );
  }
}
