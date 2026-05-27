-- 025_signal_candidate_fanouts_loose_fk.sql
-- Drop the FK on signal_candidate_fanouts.signal_id so the audit row can
-- be written before the typed `signal.discovered` projector materializes
-- the signal. Fanout now records audit synchronously while the projector
-- inserts the workspace-scoped row asynchronously off the event bus.
--
-- Integrity is still application-level: signal_id is a UUID we minted in
-- fanout, and the projector inserts that exact id (with `on conflict (id)
-- do nothing` so retries are idempotent).

alter table signal_candidate_fanouts
  drop constraint if exists signal_candidate_fanouts_signal_id_fkey;
