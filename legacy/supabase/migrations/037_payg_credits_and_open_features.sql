-- ============================================================
-- 037_payg_credits_and_open_features.sql
-- Free workspace + pay-as-you-go lead unlock credits
-- ============================================================

ALTER TABLE lead_credit_transactions
  DROP CONSTRAINT IF EXISTS lead_credit_transactions_reason_check;

ALTER TABLE lead_credit_transactions
  ADD CONSTRAINT lead_credit_transactions_reason_check
  CHECK (reason IN ('starter', 'purchase', 'consume', 'refund', 'admin_adjustment'));

DO $$
DECLARE
  profile_row RECORD;
BEGIN
  FOR profile_row IN
    SELECT user_id FROM user_profiles
  LOOP
    PERFORM add_lead_credits(
      profile_row.user_id,
      20,
      'starter:' || profile_row.user_id::text,
      'starter',
      '{"source":"payg_migration"}'::jsonb
    );
  END LOOP;
END $$;

UPDATE client_accounts
SET is_archived = false
WHERE is_archived = true;

UPDATE user_profiles
SET plan = 'free'
WHERE plan <> 'free';

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_plan_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_plan_check
  CHECK (plan = 'free');

UPDATE subscriptions
SET plan = 'free'
WHERE plan <> 'free';
