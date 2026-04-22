-- ============================================================
-- 015_client_scope_constraints.sql
-- Unique/index fixes for multi-client workspaces
-- ============================================================

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_user_signal_unique;

CREATE UNIQUE INDEX IF NOT EXISTS leads_user_client_signal_unique_idx
  ON leads(user_id, client_id, signal_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE watchlist_companies DROP CONSTRAINT IF EXISTS watchlist_companies_user_id_company_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS watchlist_user_client_company_unique_idx
  ON watchlist_companies(user_id, client_id, company_name)
  WHERE client_id IS NOT NULL;

ALTER TABLE blocked_companies DROP CONSTRAINT IF EXISTS blocked_companies_user_id_company_domain_key;

CREATE UNIQUE INDEX IF NOT EXISTS blocked_user_client_domain_unique_idx
  ON blocked_companies(user_id, client_id, company_domain)
  WHERE client_id IS NOT NULL AND company_domain IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS blocked_user_client_name_unique_idx
  ON blocked_companies(user_id, client_id, company_name)
  WHERE client_id IS NOT NULL;
