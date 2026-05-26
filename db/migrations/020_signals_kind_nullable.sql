-- 020_signals_kind_nullable.sql
-- Workspace-driven adapters (RSS, Google News, Reddit, HN front) ingest
-- items whose kind isn't knowable until stage 2 classifies them. Allow
-- signals.kind to be NULL through the gap between stage 1 insert and
-- stage 2 classification. Existing rows with a non-null kind are
-- unaffected.

alter table signals alter column kind drop not null;
