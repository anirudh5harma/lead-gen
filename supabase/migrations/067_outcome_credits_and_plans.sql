-- ============================================================
-- 067_outcome_credits_and_plans.sql
-- Bombsell v2 Phase 4: outcome-based credit ledger + Launch/Team plan tiers.
-- See PLAN.md §6.
-- ============================================================

-- ── credit_ledger ─────────────────────────────────────────────
-- Every grant / debit, workspace-scoped, fully auditable. The running balance
-- mirror lives on user_profiles.lead_credit_balance (decremented on debit).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('grant', 'debit')),
  event_type    TEXT NOT NULL,        -- e.g. 'monthly_grant', 'outbound_positive_reply', 'outbound_meeting_booked', 'content_post_published', 'content_post_winner', 'contact_enriched', 'overage_purchase'
  units         NUMERIC(10, 3) NOT NULL,
  balance_after NUMERIC(12, 3),
  lead_id       UUID,
  post_id       UUID,
  note          TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_ws_idx ON credit_ledger(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_ledger_event_idx ON credit_ledger(workspace_id, event_type);
-- idempotency: don't double-charge the same outcome
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_lead_event_idx ON credit_ledger(workspace_id, event_type, lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_post_event_idx ON credit_ledger(workspace_id, event_type, post_id) WHERE post_id IS NOT NULL;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_ledger_select ON credit_ledger;
CREATE POLICY credit_ledger_select ON credit_ledger FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS credit_ledger_insert ON credit_ledger;
CREATE POLICY credit_ledger_insert ON credit_ledger FOR INSERT WITH CHECK (user_id = auth.uid());

-- ── plan tiers (Launch / Team) ────────────────────────────────
-- Existing free/growth/scale/enterprise rows stay valid for back-compat; v2
-- onboards everyone onto 'launch' or 'team'. Tier = features only; everything
-- variable is metered through credit_ledger above.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS monthly_credit_grant NUMERIC(12, 3) NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS credits_granted_at TIMESTAMPTZ;

-- bump default grant for anyone already on a paid-ish plan; launch gets a starter bundle
UPDATE user_profiles SET monthly_credit_grant = CASE
  WHEN plan IN ('team', 'enterprise', 'scale') THEN 350
  WHEN plan IN ('launch', 'growth') THEN 100
  ELSE monthly_credit_grant
END WHERE monthly_credit_grant = 0;
