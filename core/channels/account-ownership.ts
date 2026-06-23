import type { Pool, PoolClient } from "pg";

export const USER_CONNECTED_CHANNEL_ACCOUNT_KINDS = [
  "oauth_outlook",
  "linkedin_session",
  "linkedin_oauth",
] as const;

export async function repairUserConnectedChannelAccountOwners(
  pool: Pool | PoolClient,
  workspaceId: string,
): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `with latest_auth as (
       select distinct on (
                e.workspace_id,
                ((e.payload ->> 'channel_account_id')::uuid)
              )
              e.workspace_id,
              (e.payload ->> 'channel_account_id')::uuid as channel_account_id,
              case
                when coalesce(e.payload ->> 'user_id', '') ~* '^[0-9a-f-]{36}$'
                  then (e.payload ->> 'user_id')::uuid
                when coalesce(substring(e.producer_ref from '^user:([0-9a-f-]{36})$'), '') ~* '^[0-9a-f-]{36}$'
                  then substring(e.producer_ref from '^user:([0-9a-f-]{36})$')::uuid
                else null
              end as user_id
         from events e
        where e.workspace_id = $1
          and e.event_type in (
                'email.outlook.authorization.received',
                'linkedin.account.authorization.received'
              )
          and e.payload ? 'channel_account_id'
        order by
              e.workspace_id,
              ((e.payload ->> 'channel_account_id')::uuid),
              e.occurred_at desc,
              e.id desc
     )
     update channel_accounts ca
        set user_id = latest_auth.user_id
       from latest_auth
      where ca.workspace_id = latest_auth.workspace_id
        and ca.id = latest_auth.channel_account_id
        and ca.kind in ('oauth_outlook', 'linkedin_session', 'linkedin_oauth')
        and ca.user_id is null
        and latest_auth.user_id is not null
      returning ca.id`,
    [workspaceId],
  );
  return result.rowCount ?? 0;
}
