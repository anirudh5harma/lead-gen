-- 014_signal_novelty_uniqueness.sql
-- Source ingestion must be race-safe: a feed item with the same novelty key
-- from the same Source is the same underlying Signal even if two workers poll
-- concurrently. Manual Signals keep source_id null and are intentionally not
-- covered by this invariant.

create unique index signals_workspace_source_novelty_unique_idx
  on signals (workspace_id, source_id, novelty_key)
  where source_id is not null and novelty_key is not null;
