-- 021_event_idempotency_keys.sql
-- External callbacks are retried. Collapse a publisher retry to one durable
-- event within the same workspace and event family.

alter table events
  add column idempotency_key text;

create unique index events_idempotency_idx
  on events (workspace_id, event_type, idempotency_key)
  where idempotency_key is not null;
