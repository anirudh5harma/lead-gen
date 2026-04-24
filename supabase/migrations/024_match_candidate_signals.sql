-- ============================================================
-- 024_match_candidate_signals.sql
-- Bounded ANN candidate retrieval for workspace lead matching
-- ============================================================

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS novelty_key TEXT;

CREATE OR REPLACE FUNCTION match_candidate_signals(
  p_profile_embedding VECTOR,
  p_signal_types TEXT[],
  p_since TIMESTAMPTZ,
  p_limit INT DEFAULT 24,
  p_similarity_floor FLOAT DEFAULT 0.18
)
RETURNS TABLE (
  id UUID,
  company_name TEXT,
  company_domain TEXT,
  novelty_key TEXT,
  signal_type TEXT,
  summary TEXT,
  headline TEXT,
  published_at TIMESTAMPTZ,
  source_name TEXT,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  WITH ranked AS (
    SELECT
      s.id,
      s.company_name,
      s.company_domain,
      s.novelty_key,
      s.signal_type,
      s.summary,
      s.headline,
      s.published_at,
      s.source_name,
      1 - (s.signal_embedding <=> p_profile_embedding) AS similarity
    FROM signals s
    WHERE s.published_at >= p_since
      AND s.signal_embedding IS NOT NULL
      AND (
        COALESCE(array_length(p_signal_types, 1), 0) = 0
        OR s.signal_type = ANY(p_signal_types)
      )
    ORDER BY s.signal_embedding <=> p_profile_embedding
    LIMIT GREATEST(COALESCE(p_limit, 24) * 4, COALESCE(p_limit, 24))
  )
  SELECT
    ranked.id,
    ranked.company_name,
    ranked.company_domain,
    ranked.novelty_key,
    ranked.signal_type,
    ranked.summary,
    ranked.headline,
    ranked.published_at,
    ranked.source_name,
    ranked.similarity
  FROM ranked
  WHERE ranked.similarity >= p_similarity_floor
  ORDER BY ranked.similarity DESC, ranked.published_at DESC
  LIMIT COALESCE(p_limit, 24);
$$;
