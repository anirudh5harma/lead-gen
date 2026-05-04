-- ============================================================
-- 047_outreach_verification_hardening.sql
-- Phase 2 sales/outreach hardening: persist send-time contact
-- verification freshness and failure reasons on leads.
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS contact_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS last_contact_verification_error TEXT;

CREATE INDEX IF NOT EXISTS leads_contact_verified_freshness_idx
  ON leads(contact_verified_at DESC)
  WHERE contact_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_stale_verified_contact_idx
  ON leads(created_at DESC)
  WHERE contact_email IS NOT NULL
    AND contact_verified = TRUE
    AND status NOT IN ('sent', 'replied', 'booked', 'dismissed');
