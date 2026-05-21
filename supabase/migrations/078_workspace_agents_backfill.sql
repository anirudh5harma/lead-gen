-- ============================================================
-- 078_workspace_agents_backfill.sql
-- Backfills workspace_agents rows for every existing workspace
-- (personal accounts + client_accounts) so the per-agent gates in
-- cron jobs (notably cron/generate-content-ideas, which filters
-- agent_role='idea' AND enabled=true) match every legitimate
-- workspace, not just those onboarded with the content engine
-- selected. Idempotent — relies on the existing
-- (workspace_id, agent_role) unique index.
-- ============================================================

-- Canonical agent → engine mapping. Mirrors lib/agents/core/engines.ts:
--   outbound: signal, match, enrich, outreach, safety, reply, booking, followup
--   content:  idea, writer, editor, publisher, engagement, repurpose
--   shared:   insight, crm, operator
-- Add-on roles (insight, crm, repurpose, engagement) ship disabled by default
-- to mirror ADDON_ROLES in code.
WITH agent_catalog(role, engine, addon) AS (
  VALUES
    ('signal',    'outbound', FALSE),
    ('match',     'outbound', FALSE),
    ('enrich',    'outbound', FALSE),
    ('outreach',  'outbound', FALSE),
    ('safety',    'outbound', FALSE),
    ('reply',     'outbound', FALSE),
    ('booking',   'outbound', FALSE),
    ('followup',  'outbound', FALSE),
    ('idea',      'content',  FALSE),
    ('writer',    'content',  FALSE),
    ('editor',    'content',  FALSE),
    ('publisher', 'content',  FALSE),
    ('engagement','content',  TRUE),
    ('repurpose', 'content',  TRUE),
    ('insight',   'shared',   TRUE),
    ('crm',       'shared',   TRUE),
    ('operator',  'shared',   FALSE)
),
-- Each workspace shows up exactly once, paired with the user that owns it.
-- Personal workspaces use the user's own id as workspace_id; client_accounts
-- workspaces use the client_accounts.id with their owner user_id.
workspace_pairs AS (
  SELECT id AS workspace_id, id AS user_id FROM auth.users
  UNION
  SELECT id AS workspace_id, user_id FROM client_accounts WHERE user_id IS NOT NULL
)
INSERT INTO workspace_agents (workspace_id, user_id, agent_role, engine, enabled, autonomy, config)
SELECT
  wp.workspace_id,
  wp.user_id,
  ac.role,
  ac.engine,
  NOT ac.addon AS enabled,
  'approve_first'::text AS autonomy,
  '{}'::jsonb AS config
FROM workspace_pairs wp
CROSS JOIN agent_catalog ac
ON CONFLICT (workspace_id, agent_role) DO NOTHING;
