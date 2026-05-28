-- ============================================================
-- 005_contact_enrichment.sql
-- Per-lead verified contact storage + bounce suppression table
-- ============================================================

-- 1. Contact columns on leads (populated by background enrichment cron)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_email         TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_name          TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_title         TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_source        TEXT;  -- 'apollo' | 'hunter' | 'scrape'
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_verified      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_enriched_at   TIMESTAMPTZ;

-- 2. Bounce / complaint suppression (separate from unsubscribes)
CREATE TABLE IF NOT EXISTS bounced_emails (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  reason     TEXT NOT NULL DEFAULT 'bounce',  -- 'bounce' | 'complaint'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS leads_needs_enrichment_idx
  ON leads(created_at DESC)
  WHERE contact_email IS NULL AND status != 'dismissed';

CREATE INDEX IF NOT EXISTS leads_contact_email_idx ON leads(contact_email) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS bounced_email_idx        ON bounced_emails(email);
