-- 018_signal_overflow_polymorphic.sql
-- signal_overflow is a forensics audit for any item dropped during
-- ingestion — from either workspace-scoped graph_sources OR
-- platform-shared platform_signal_sources. The original FK to
-- graph_sources is too narrow. Drop it; the column stays as a typed
-- uuid that the application populates with whichever source kind is
-- relevant. The payload jsonb carries enough context to disambiguate.

alter table signal_overflow
  drop constraint if exists signal_overflow_source_id_fkey;
