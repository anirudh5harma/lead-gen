-- ============================================================
-- 056_marketing_content_rls_writes.sql
-- Allow authenticated users to create/update their own marketing
-- content intelligence rows during user-triggered refreshes.
-- ============================================================

DROP POLICY IF EXISTS "Users manage own content context snapshots" ON gtm_content_context_snapshots;
CREATE POLICY "Users manage own content context snapshots"
  ON gtm_content_context_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own content pillars" ON gtm_content_pillars;
CREATE POLICY "Users manage own content pillars"
  ON gtm_content_pillars FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own content feedback events" ON gtm_content_feedback_events;
CREATE POLICY "Users manage own content feedback events"
  ON gtm_content_feedback_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own inspiration refs" ON gtm_content_inspiration_refs;
CREATE POLICY "Users manage own inspiration refs"
  ON gtm_content_inspiration_refs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
