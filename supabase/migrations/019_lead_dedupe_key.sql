ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS leads_client_dedupe_key_unique_idx
  ON leads(client_id, dedupe_key)
  WHERE client_id IS NOT NULL AND dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_dedupe_key_idx
  ON leads(dedupe_key)
  WHERE dedupe_key IS NOT NULL;
