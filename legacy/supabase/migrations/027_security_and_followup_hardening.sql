-- ============================================================
-- 027_security_and_followup_hardening.sql
-- Tighten internal-table RLS and make follow-up sending claimable
-- ============================================================

-- Restrict internal signal ingestion tables to service-role writes only.
DROP POLICY IF EXISTS "Service role can insert signals" ON signals;
CREATE POLICY "Service role can insert signals"
  ON signals FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert signal candidates" ON signal_candidates;
CREATE POLICY "Service role can insert signal candidates"
  ON signal_candidates FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can read signal candidates" ON signal_candidates;

DROP POLICY IF EXISTS "Service role can update signal candidates" ON signal_candidates;
CREATE POLICY "Service role can update signal candidates"
  ON signal_candidates FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

-- Shared contact caches should not be globally readable to authenticated users.
DROP POLICY IF EXISTS "authenticated_read" ON company_contacts;
DROP POLICY IF EXISTS "authenticated_read_candidates" ON company_contact_candidates;

-- Add explicit claim state for scheduled follow-ups so overlapping cron runs
-- cannot send the same email twice.
ALTER TABLE scheduled_followups
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_token TEXT;

CREATE INDEX IF NOT EXISTS followups_due_claim_idx
  ON scheduled_followups(scheduled_for, processing_started_at)
  WHERE sent_at IS NULL;

CREATE OR REPLACE FUNCTION claim_due_followups(
  p_limit INT,
  p_claim_token TEXT,
  p_now TIMESTAMPTZ,
  p_stale_before TIMESTAMPTZ
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  lead_id UUID,
  scheduled_for TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT sf.id
    FROM scheduled_followups sf
    WHERE sf.sent_at IS NULL
      AND sf.scheduled_for <= p_now
      AND (
        sf.processing_started_at IS NULL OR
        sf.processing_started_at < p_stale_before
      )
    ORDER BY sf.scheduled_for ASC, sf.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE scheduled_followups sf
    SET processing_started_at = p_now,
        processing_token = p_claim_token
    FROM candidates c
    WHERE sf.id = c.id
    RETURNING sf.id, sf.user_id, sf.lead_id, sf.scheduled_for
  )
  SELECT * FROM claimed;
$$;

REVOKE ALL ON FUNCTION claim_due_followups(INT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_due_followups(INT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
