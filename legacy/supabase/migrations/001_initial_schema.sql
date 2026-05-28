-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- User profiles: who they are and what they sell
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  company_name text NOT NULL,
  industry text NOT NULL CHECK (industry IN ('tech', 'finance', 'health')),
  target_industries text[] NOT NULL DEFAULT '{}',
  services_description text NOT NULL,
  icp_keywords text[] DEFAULT '{}',
  profile_embedding vector(1536),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Raw signals from RSS feeds
CREATE TABLE IF NOT EXISTS signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  company_domain text,
  signal_type text NOT NULL CHECK (signal_type IN ('funding', 'acquisition', 'expansion', 'regulation', 'hiring')),
  headline text NOT NULL,
  summary text,
  funding_amount text,
  source_url text,
  published_at timestamptz,
  signal_embedding vector(1536),
  processed_at timestamptz DEFAULT now()
);

-- Deduplicate signals by source URL (same article shouldn't be inserted twice)
CREATE UNIQUE INDEX IF NOT EXISTS signals_source_url_idx
  ON signals (source_url) WHERE source_url IS NOT NULL;

-- Matched leads: signal × user_profile with relevance score
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES signals(id) ON DELETE CASCADE,
  target_company text NOT NULL,
  relevance_score int NOT NULL CHECK (relevance_score BETWEEN 1 AND 10),
  relevance_reason text,
  status text DEFAULT 'new' CHECK (status IN ('new', 'viewed', 'emailed', 'dismissed')),
  created_at timestamptz DEFAULT now()
);

-- Outreach drafts generated on user click
CREATE TABLE IF NOT EXISTS outreach_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE UNIQUE,
  subject text,
  body text,
  stakeholders jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS leads_user_id_status_idx ON leads(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS signals_published_at_idx ON signals(published_at DESC);
CREATE INDEX IF NOT EXISTS leads_signal_id_idx ON leads(signal_id);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage own profile"
  ON user_profiles FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read and update own leads"
  ON leads FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own outreach drafts"
  ON outreach_drafts FOR ALL
  USING (
    auth.uid() = (SELECT user_id FROM leads WHERE id = outreach_drafts.lead_id)
  );

CREATE POLICY "Signals are readable by all authenticated users"
  ON signals FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can insert signals"
  ON signals FOR INSERT
  WITH CHECK (true);

-- Helper function: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Cosine similarity helper for lead matching
-- Returns a value between -1 and 1 (higher = more similar)
CREATE OR REPLACE FUNCTION cosine_similarity(a vector, b vector)
RETURNS float AS $$
  SELECT 1 - (a <=> b);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- IVFFlat indexes for fast approximate nearest-neighbor search
CREATE INDEX IF NOT EXISTS signals_embedding_idx
  ON signals USING ivfflat (signal_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS profiles_embedding_idx
  ON user_profiles USING ivfflat (profile_embedding vector_cosine_ops)
  WITH (lists = 10);
