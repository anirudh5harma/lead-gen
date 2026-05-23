CREATE TABLE IF NOT EXISTS blocked_companies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  company_domain TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, company_domain)
);

CREATE INDEX IF NOT EXISTS blocked_companies_user_idx ON blocked_companies(user_id);
CREATE INDEX IF NOT EXISTS blocked_companies_domain_idx ON blocked_companies(company_domain) WHERE company_domain IS NOT NULL;

ALTER TABLE blocked_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_blocks" ON blocked_companies FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
