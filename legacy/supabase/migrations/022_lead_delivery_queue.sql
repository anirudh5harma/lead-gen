-- ============================================================
-- 022_lead_delivery_queue.sql
-- Durable matched-signal backlog with paced delivery
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_delivery_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  signal_id         UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  target_company    TEXT NOT NULL,
  company_domain    TEXT,
  relevance_score   INT NOT NULL CHECK (relevance_score BETWEEN 1 AND 10),
  relevance_reason  TEXT,
  priority_score    DOUBLE PRECISION NOT NULL DEFAULT 0,
  dedupe_key        TEXT NOT NULL,
  source_name       TEXT,
  published_at      TIMESTAMPTZ,
  match_debug       JSONB,
  queue_status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (queue_status IN ('pending', 'delivered', 'duplicate', 'expired')),
  next_delivery_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  queued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at      TIMESTAMPTZ,
  last_attempted_at TIMESTAMPTZ,
  attempt_count     INT NOT NULL DEFAULT 0,
  delivered_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, signal_id)
);

ALTER TABLE lead_delivery_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage lead delivery queue"
  ON lead_delivery_queue FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER lead_delivery_queue_updated_at
  BEFORE UPDATE ON lead_delivery_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS lead_delivery_queue_status_delivery_idx
  ON lead_delivery_queue(queue_status, next_delivery_at, priority_score DESC, queued_at ASC);

CREATE INDEX IF NOT EXISTS lead_delivery_queue_user_status_idx
  ON lead_delivery_queue(user_id, queue_status, next_delivery_at, queued_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS lead_delivery_queue_client_dedupe_live_idx
  ON lead_delivery_queue(client_id, dedupe_key)
  WHERE queue_status IN ('pending', 'delivered');
