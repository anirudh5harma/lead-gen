-- 045_channel_account_user_ownership.sql
-- User-connected channel accounts belong to the workspace member who
-- authorized them. Persist that ownership explicitly so profile and calendar
-- surfaces do not leak one teammate's account identity to another.

alter table channel_accounts
  add column if not exists user_id uuid;

create index if not exists channel_accounts_workspace_user_kind_idx
  on channel_accounts (workspace_id, user_id, kind, status)
  where user_id is not null;

with latest_auth as (
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
   where e.event_type in (
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
   and latest_auth.user_id is not null;
