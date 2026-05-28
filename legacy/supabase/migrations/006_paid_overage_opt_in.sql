-- ============================================================
-- 006_paid_overage_opt_in.sql
-- Persist paid-plan opt-in for lead overages
-- ============================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS allow_lead_overage BOOLEAN NOT NULL DEFAULT false;
