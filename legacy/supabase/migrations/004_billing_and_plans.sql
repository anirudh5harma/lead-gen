-- ============================================================
-- 004_billing_and_plans.sql
-- Pricing tiers, Stripe subscriptions, unsubscribe list,
-- scheduled follow-ups, Slack webhook, reply tracking
-- ============================================================

-- 1. Plan + usage tracking on user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free','pro','max'));

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS leads_used_this_month INT NOT NULL DEFAULT 0;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS leads_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;

-- 2. Dodo Payments subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  dodo_customer_id      TEXT,
  dodo_subscription_id  TEXT,
  plan                  TEXT NOT NULL DEFAULT 'free',
  status                TEXT NOT NULL DEFAULT 'active',
  next_billing_date     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- 3. Unsubscribe list (no auth needed for unsubscribe, service-role only writes)
CREATE TABLE IF NOT EXISTS unsubscribed_emails (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Scheduled follow-ups
CREATE TABLE IF NOT EXISTS scheduled_followups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id        UUID REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_for  TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'followups_lead_unique'
  ) THEN
    ALTER TABLE scheduled_followups ADD CONSTRAINT followups_lead_unique UNIQUE (lead_id);
  END IF;
END $$;
ALTER TABLE scheduled_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own followups"
  ON scheduled_followups FOR ALL
  USING (auth.uid() = user_id);

-- 5. Store Resend message_id on leads for reply matching
ALTER TABLE leads ADD COLUMN IF NOT EXISTS message_id TEXT;

-- 6. Unique constraint on leads (user_id, signal_id) to prevent duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_user_signal_unique'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_user_signal_unique UNIQUE (user_id, signal_id);
  END IF;
END $$;

-- 7. RPC: atomic increment of leads_used_this_month
CREATE OR REPLACE FUNCTION increment_leads_used(p_user_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE user_profiles
  SET leads_used_this_month = leads_used_this_month + 1
  WHERE user_id = p_user_id;
$$;

-- 8. Indexes
CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx         ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS followups_user_scheduled_idx      ON scheduled_followups(user_id, scheduled_for) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_message_id_idx              ON leads(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS unsubscribed_email_idx            ON unsubscribed_emails(email);
