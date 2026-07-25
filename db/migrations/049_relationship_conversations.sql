-- 049_relationship_conversations.sql
-- A Conversation represents one durable relationship with a counterparty.
-- Signals are evidence attached to that relationship, not thread identity.

create table conversation_signals (
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  signal_id       uuid not null references signals(id) on delete cascade,
  role            text not null check (role in ('primary', 'supporting')),
  reason          text not null,
  score           numeric(5,4),
  attached_at     timestamptz not null default now(),
  properties      jsonb not null default '{}'::jsonb,
  primary key (workspace_id, conversation_id, signal_id)
);

create index conversation_signals_workspace_signal_idx
  on conversation_signals (workspace_id, signal_id, attached_at desc);

alter table conversation_signals enable row level security;

create policy conversation_signals_member_all on conversation_signals
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

insert into conversation_signals (
  workspace_id, conversation_id, signal_id, role, reason, attached_at
)
select workspace_id, id, origin_signal_id, 'primary', 'legacy_origin', started_at
  from conversations
 where origin_signal_id is not null
on conflict do nothing;

with conversation_message_counts as (
  select
    c.id,
    c.workspace_id,
    c.counterparty_person_id,
    c.counterparty_company_id,
    c.started_at,
    c.last_activity_at,
    count(m.id) as message_count
  from conversations c
  left join messages m
    on m.workspace_id = c.workspace_id
   and m.conversation_id = c.id
  where c.counterparty_company_id is not null
  group by c.id
),
ranked as (
  select
    *,
    first_value(id) over (
      partition by workspace_id, counterparty_person_id, counterparty_company_id
      order by message_count desc, last_activity_at desc, started_at asc, id asc
    ) as survivor_id,
    row_number() over (
      partition by workspace_id, counterparty_person_id, counterparty_company_id
      order by message_count desc, last_activity_at desc, started_at asc, id asc
    ) as rank_in_group
  from conversation_message_counts
),
duplicates as (
  select * from ranked where rank_in_group > 1
),
survivor_rollup as (
  select
    survivor_id,
    min(started_at) as started_at,
    max(last_activity_at) as last_activity_at,
    jsonb_agg(id order by last_activity_at desc, started_at asc, id asc) as merged_ids
  from duplicates
  group by survivor_id
),
copied_signals as (
  insert into conversation_signals (
    workspace_id, conversation_id, signal_id, role, reason, score, attached_at, properties
  )
  select
    cs.workspace_id, d.survivor_id, cs.signal_id, cs.role,
    cs.reason, cs.score, cs.attached_at, cs.properties
  from conversation_signals cs
  join duplicates d
    on d.workspace_id = cs.workspace_id
   and d.id = cs.conversation_id
  on conflict (workspace_id, conversation_id, signal_id) do update set
    role = case
      when conversation_signals.role = 'primary' then conversation_signals.role
      else excluded.role
    end,
    attached_at = least(conversation_signals.attached_at, excluded.attached_at)
  returning conversation_id
),
updated_survivors as (
  update conversations c
     set started_at = least(c.started_at, r.started_at),
         last_activity_at = greatest(c.last_activity_at, r.last_activity_at),
         properties = c.properties || jsonb_build_object(
           'relationship_threads_merged', true,
           'merged_relationship_conversation_ids',
           coalesce(c.properties->'merged_relationship_conversation_ids', '[]'::jsonb) || r.merged_ids
         )
    from survivor_rollup r
   where c.id = r.survivor_id
  returning c.id
),
repointed_messages as (
  update messages m
     set conversation_id = d.survivor_id
    from duplicates d
   where m.workspace_id = d.workspace_id
     and m.conversation_id = d.id
  returning m.id
),
repointed_outcomes as (
  update outcomes o
     set conversation_id = d.survivor_id
    from duplicates d
   where o.workspace_id = d.workspace_id
     and o.conversation_id = d.id
  returning o.id
),
deleted_signal_links as (
  delete from conversation_signals cs
  using duplicates d
  where cs.workspace_id = d.workspace_id
    and cs.conversation_id = d.id
  returning cs.signal_id
),
repair_side_effects as (
  select
    (select count(*) from copied_signals) as copied_signals,
    (select count(*) from updated_survivors) as updated_survivors,
    (select count(*) from repointed_messages) as repointed_messages,
    (select count(*) from repointed_outcomes) as repointed_outcomes,
    (select count(*) from deleted_signal_links) as deleted_signal_links
)
delete from conversations c
using duplicates d, repair_side_effects
where c.id = d.id;

drop index if exists conversations_signal_counterparty_open_idx;

create unique index conversations_relationship_counterparty_idx
  on conversations (
    workspace_id,
    counterparty_person_id,
    counterparty_company_id
  )
  where counterparty_company_id is not null;
