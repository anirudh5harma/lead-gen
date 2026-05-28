-- Shared company-level contact cache (keyed by domain, 30-day TTL)
-- One row per company domain; all leads for that domain share this contact.
-- Dramatically reduces Apollo/Hunter API calls when multiple users have leads
-- from the same company.

CREATE TABLE IF NOT EXISTS company_contacts (
  domain           TEXT PRIMARY KEY,
  contact_email    TEXT NOT NULL,
  contact_name     TEXT,
  contact_title    TEXT,
  contact_source   TEXT NOT NULL,  -- 'apollo' | 'hunter'
  contact_verified BOOLEAN NOT NULL DEFAULT FALSE,
  zb_status        TEXT,
  enriched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_contacts_enriched_at_idx
  ON company_contacts(enriched_at DESC);

ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;

-- Service role (cron, server routes): full access
CREATE POLICY "service_all" ON company_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users: read-only (on-demand enrichment in draft route)
CREATE POLICY "authenticated_read" ON company_contacts
  FOR SELECT TO authenticated USING (true);
