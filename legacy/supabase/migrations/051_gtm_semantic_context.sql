-- ============================================================
-- 051_gtm_semantic_context.sql
-- Graph-aware semantic retrieval over GTM entities.
-- ============================================================

ALTER TABLE gtm_entity_embeddings
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES gtm_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS content_preview TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS gtm_entity_embeddings_account_lookup_idx
  ON gtm_entity_embeddings(user_id, client_id, account_id, entity_type, created_at DESC)
  WHERE account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION match_gtm_entity_embeddings(
  p_user_id UUID,
  p_client_id UUID,
  p_query_embedding VECTOR(1536),
  p_match_count INT DEFAULT 12,
  p_entity_types TEXT[] DEFAULT NULL,
  p_account_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  entity_type TEXT,
  entity_id UUID,
  account_id UUID,
  source TEXT,
  content_hash TEXT,
  content_preview TEXT,
  metadata JSONB,
  similarity DOUBLE PRECISION,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    embedding.id,
    embedding.entity_type,
    embedding.entity_id,
    embedding.account_id,
    embedding.source,
    embedding.content_hash,
    embedding.content_preview,
    embedding.metadata,
    1 - (embedding.embedding <=> p_query_embedding) AS similarity,
    embedding.created_at
  FROM gtm_entity_embeddings embedding
  WHERE embedding.user_id = p_user_id
    AND embedding.client_id IS NOT DISTINCT FROM p_client_id
    AND embedding.embedding IS NOT NULL
    AND (p_entity_types IS NULL OR embedding.entity_type = ANY(p_entity_types))
    AND (p_account_id IS NULL OR embedding.account_id = p_account_id)
  ORDER BY embedding.embedding <=> p_query_embedding
  LIMIT LEAST(GREATEST(COALESCE(p_match_count, 12), 1), 50);
$$;
