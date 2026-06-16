-- 038_autonomous_default_backfill.sql
-- Product default is autonomous after eval/channel checks. Backfill legacy
-- approve-first defaults so existing workspaces do not see approval friction.

update workspaces
   set settings = settings ||
     jsonb_build_object(
       'autonomy_mode', coalesce(settings->>'autonomy_mode', 'autonomous'),
       'default_channel_approval',
       case
         when settings->>'autonomy_mode' = 'review_only' then 'always'
         else 'none'
       end
     )
 where settings->>'default_channel_approval' is null
    or settings->>'default_channel_approval' = 'approve_first';

with next_reps as (
  select id,
         jsonb_set(
           autonomy,
           '{channels}',
           coalesce(
             (
               select jsonb_object_agg(
                 key,
                 case
                   when value->>'approval' = 'approve_first'
                     then jsonb_set(value, '{approval}', '"none"'::jsonb, true)
                   else value
                 end
               )
               from jsonb_each(
                 case
                   when jsonb_typeof(autonomy->'channels') = 'object'
                     then autonomy->'channels'
                   else '{}'::jsonb
                 end
               )
             ),
             '{}'::jsonb
           ),
           true
         ) as autonomy
    from reps
   where autonomy ? 'channels'
)
update reps
   set autonomy = next_reps.autonomy,
       updated_at = now()
  from next_reps
 where reps.id = next_reps.id
   and reps.autonomy is distinct from next_reps.autonomy;

with next_plays as (
  select id,
         jsonb_set(
           autonomy,
           '{channels}',
           coalesce(
             (
               select jsonb_object_agg(
                 key,
                 case
                   when value->>'approval' = 'approve_first'
                     then jsonb_set(value, '{approval}', '"none"'::jsonb, true)
                   else value
                 end
               )
               from jsonb_each(
                 case
                   when jsonb_typeof(autonomy->'channels') = 'object'
                     then autonomy->'channels'
                   else '{}'::jsonb
                 end
               )
             ),
             '{}'::jsonb
           ),
           true
         ) as autonomy
    from plays
   where autonomy ? 'channels'
)
update plays
   set autonomy = next_plays.autonomy,
       updated_at = now()
  from next_plays
 where plays.id = next_plays.id
   and plays.autonomy is distinct from next_plays.autonomy;
