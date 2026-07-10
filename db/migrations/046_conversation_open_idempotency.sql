-- 046_conversation_open_idempotency.sql
-- Repair duplicate signal-origin conversations and enforce the idempotency
-- grain used by conversation.opened emitters.

with conversation_message_counts as (
  select
    c.id,
    c.workspace_id,
    c.rep_id,
    c.counterparty_person_id,
    c.origin_signal_id,
    c.started_at,
    c.last_activity_at,
    count(m.id) as message_count
  from conversations c
  left join messages m
    on m.workspace_id = c.workspace_id
   and m.conversation_id = c.id
  where c.origin_signal_id is not null
  group by c.id
),
ranked as (
  select
    *,
    first_value(id) over (
      partition by workspace_id, rep_id, counterparty_person_id, origin_signal_id
      order by message_count desc, last_activity_at desc, started_at asc, id asc
    ) as survivor_id,
    row_number() over (
      partition by workspace_id, rep_id, counterparty_person_id, origin_signal_id
      order by message_count desc, last_activity_at desc, started_at asc, id asc
    ) as rank_in_group
  from conversation_message_counts
),
duplicates as (
  select *
  from ranked
  where rank_in_group > 1
),
survivor_rollup as (
  select
    survivor_id,
    min(started_at) as started_at,
    max(last_activity_at) as last_activity_at,
    jsonb_agg(id order by message_count desc, last_activity_at desc, started_at asc, id asc) as merged_ids
  from duplicates
  group by survivor_id
),
updated_survivors as (
  update conversations c
     set started_at = least(c.started_at, r.started_at),
         last_activity_at = greatest(c.last_activity_at, r.last_activity_at),
         properties = c.properties || jsonb_build_object(
           'merged_duplicate_conversation_ids',
           coalesce(c.properties->'merged_duplicate_conversation_ids', '[]'::jsonb) || r.merged_ids
         )
    from survivor_rollup r
   where c.id = r.survivor_id
  returning c.id
),
repointed_messages as (
  update messages m
     set conversation_id = d.survivor_id
    from duplicates d
   where m.conversation_id = d.id
     and m.workspace_id = d.workspace_id
  returning m.id
),
repointed_outcomes as (
  update outcomes o
     set conversation_id = d.survivor_id
    from duplicates d
   where o.conversation_id = d.id
     and o.workspace_id = d.workspace_id
  returning o.id
),
repair_side_effects as (
  select
    (select count(*) from updated_survivors) as updated_survivors,
    (select count(*) from repointed_messages) as repointed_messages,
    (select count(*) from repointed_outcomes) as repointed_outcomes
)
delete from conversations c
using duplicates d, repair_side_effects r
where c.id = d.id;

create unique index conversations_signal_counterparty_open_idx
  on conversations (
    workspace_id,
    rep_id,
    counterparty_person_id,
    origin_signal_id
  )
  where origin_signal_id is not null;
