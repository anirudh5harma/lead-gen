ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS feed_session_id UUID,
  ADD COLUMN IF NOT EXISTS feed_session_label TEXT,
  ADD COLUMN IF NOT EXISTS feed_session_started_at TIMESTAMPTZ;

UPDATE leads l
SET
  feed_session_id = COALESCE(et.run_id, l.feed_session_id),
  feed_session_label = COALESCE(
    l.feed_session_label,
    CASE
      WHEN er.prompt IS NOT NULL AND btrim(er.prompt) <> '' THEN 'Explore · ' || left(regexp_replace(er.prompt, '\s+', ' ', 'g'), 52)
      ELSE 'Explore · ' || to_char(COALESCE(er.created_at, l.created_at), 'Mon DD HH12:MI AM')
    END
  ),
  feed_session_started_at = COALESCE(l.feed_session_started_at, er.created_at, l.created_at)
FROM explore_targets et
LEFT JOIN explore_runs er ON er.id = et.run_id
WHERE l.origin = 'explore'
  AND l.source_kind = 'explore_target'
  AND l.source_record_id = et.id
  AND (
    l.feed_session_id IS NULL
    OR l.feed_session_label IS NULL
    OR l.feed_session_started_at IS NULL
  );

UPDATE leads l
SET
  feed_session_id = COALESCE(cir.batch_id, l.feed_session_id),
  feed_session_label = COALESCE(
    l.feed_session_label,
    initcap(replace(COALESCE(cib.provider, cir.provider, 'crm'), '_', ' ')) || ' import · ' ||
      to_char(COALESCE(cib.created_at, l.created_at), 'Mon DD HH12:MI AM')
  ),
  feed_session_started_at = COALESCE(l.feed_session_started_at, cib.created_at, l.created_at)
FROM crm_import_records cir
LEFT JOIN crm_import_batches cib ON cib.id = cir.batch_id
WHERE l.origin = 'crm_import'
  AND l.source_kind = 'crm_record'
  AND l.source_record_id = cir.id
  AND (
    l.feed_session_id IS NULL
    OR l.feed_session_label IS NULL
    OR l.feed_session_started_at IS NULL
  );

CREATE INDEX IF NOT EXISTS leads_user_origin_feed_session_idx
  ON leads(user_id, origin, feed_session_started_at DESC, created_at DESC);
