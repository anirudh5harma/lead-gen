-- Durable consumers may be redelivered after a crash between state mutation
-- and acknowledgement. One authenticated ingress event may create at most
-- one Outcome of a given kind.

create unique index outcomes_ingress_event_kind_idx
  on outcomes (workspace_id, (provenance ->> 'ingress_event_id'), kind)
  where provenance ? 'ingress_event_id';
