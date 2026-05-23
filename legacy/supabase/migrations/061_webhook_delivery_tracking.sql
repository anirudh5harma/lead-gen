-- Add signal_id to webhook deliveries for deduplication
ALTER TABLE agent_webhook_deliveries
ADD COLUMN IF NOT EXISTS signal_id UUID REFERENCES signals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_webhook_deliveries_signal_id_idx
  ON agent_webhook_deliveries(signal_id);

-- Create a unique constraint to prevent duplicate deliveries
CREATE UNIQUE INDEX IF NOT EXISTS agent_webhook_deliveries_unique_signal_sub
  ON agent_webhook_deliveries(signal_id, subscription_id)
  WHERE signal_id IS NOT NULL;

-- Add webhook_broadcast_at to signals for tracking
ALTER TABLE signals
ADD COLUMN IF NOT EXISTS webhook_broadcast_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS signals_webhook_broadcast_idx
  ON signals(webhook_broadcast_at)
  WHERE webhook_broadcast_at IS NULL;
