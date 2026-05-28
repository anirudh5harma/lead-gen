CREATE TABLE IF NOT EXISTS company_contact_candidates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain             TEXT NOT NULL,
  contact_email      TEXT NOT NULL,
  contact_name       TEXT,
  contact_title      TEXT,
  contact_source     TEXT NOT NULL, -- 'fullenrich' | 'hunter' | 'pattern' | 'scrape'
  contact_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  zb_status          TEXT,
  linkedin_url       TEXT,
  base_score         INT NOT NULL DEFAULT 0,
  enriched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain, contact_email)
);

CREATE INDEX IF NOT EXISTS company_contact_candidates_domain_idx
  ON company_contact_candidates(domain, base_score DESC, enriched_at DESC);

ALTER TABLE company_contact_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_candidates" ON company_contact_candidates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_candidates" ON company_contact_candidates
  FOR SELECT TO authenticated USING (true);
