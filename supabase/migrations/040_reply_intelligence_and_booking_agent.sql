-- ============================================================
-- 040_reply_intelligence_and_booking_agent.sql
-- Reply intent, booking-agent state, and outcome visibility.
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reply_intent TEXT
    CHECK (reply_intent IS NULL OR reply_intent IN (
      'not_interested',
      'out_of_office',
      'neutral',
      'interested',
      'meeting_requested',
      'meeting_booked'
    )),
  ADD COLUMN IF NOT EXISTS reply_summary TEXT,
  ADD COLUMN IF NOT EXISTS reply_body_snippet TEXT,
  ADD COLUMN IF NOT EXISTS reply_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meeting_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_reply_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_reply_intent_idx
  ON leads(user_id, client_id, reply_intent, reply_received_at DESC)
  WHERE reply_intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_booking_agent_idx
  ON leads(user_id, client_id, meeting_detected_at DESC, booking_reply_sent_at DESC)
  WHERE meeting_detected_at IS NOT NULL;
