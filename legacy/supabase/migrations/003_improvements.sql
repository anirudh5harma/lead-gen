-- ============================================================
-- 003_improvements.sql
-- Signal source tracking, status pipeline, watchlist,
-- follow-up sequences, and profile targeting preferences
-- ============================================================

-- 1. Drop the 3-bucket industry constraint so sub-industries work
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_industry_check;

-- 2. Expand leads status to full lifecycle
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new', 'viewed', 'drafted', 'sent', 'replied', 'booked', 'dismissed'));

ALTER TABLE leads ADD COLUMN IF NOT EXISTS sent_at    timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booked_at  timestamptz;

-- 3. Watchlist — companies the user explicitly wants to monitor
CREATE TABLE IF NOT EXISTS watchlist_companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  company_domain text,
  notes        text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, company_name)
);

ALTER TABLE watchlist_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own watchlist"
  ON watchlist_companies FOR ALL
  USING (auth.uid() = user_id);

-- 4. Profile targeting preferences
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS target_signal_types  text[]
    DEFAULT '{"funding","acquisition","expansion","regulation","hiring"}';

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS min_relevance_score  int DEFAULT 6;

-- 5. Track which source produced each signal
ALTER TABLE signals ADD COLUMN IF NOT EXISTS source_name text DEFAULT 'google_news';

-- 6. Follow-up sequences (one per lead, generated after initial draft)
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid REFERENCES leads(id) ON DELETE CASCADE UNIQUE,
  followup_subject text NOT NULL,
  followup_body    text NOT NULL,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sequences"
  ON outreach_sequences FOR ALL
  USING (
    auth.uid() = (SELECT user_id FROM leads WHERE id = outreach_sequences.lead_id)
  );

-- 7. Indexes
CREATE INDEX IF NOT EXISTS watchlist_user_id_idx    ON watchlist_companies(user_id);
CREATE INDEX IF NOT EXISTS sequences_lead_id_idx    ON outreach_sequences(lead_id);
CREATE INDEX IF NOT EXISTS leads_sent_at_idx        ON leads(user_id, sent_at) WHERE sent_at IS NOT NULL;
