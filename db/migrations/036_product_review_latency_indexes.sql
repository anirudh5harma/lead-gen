-- 036_product_review_latency_indexes.sql
-- Product review surfaces are event-sourced, but the hot paths filter by
-- workspace, event type, time, and recommendation review IDs stored in JSONB.
-- These derived-view indexes keep replayable events as the source of truth
-- while avoiding broad scans as Content/AEO recommendation history grows.

create index if not exists events_workspace_type_occurred_idx
  on events (workspace_id, event_type, occurred_at desc);

create index if not exists events_recommendation_review_latest_idx
  on events (workspace_id, (payload->>'review_id'), occurred_at desc)
  where event_type = 'recommendation.reviewed'
    and payload ? 'review_id';

create index if not exists events_recommendation_mutation_latest_idx
  on events (workspace_id, (payload->>'review_id'), occurred_at desc)
  where event_type in ('recommendation.updated', 'recommendation.deleted')
    and payload ? 'review_id';

create index if not exists outcomes_recommendation_review_latest_idx
  on outcomes (workspace_id, (properties->>'recommendation_review_id'), occurred_at desc)
  where properties ? 'recommendation_review_id';
