-- ============================================================
-- 066_content_engine.sql
-- Bombsell v2 Phase 2: Content engine (LinkedIn / X) infra.
-- content_ideas · posts · social_accounts (posting partner) ·
-- workspace_llm_keys (BYO Claude/ChatGPT) · content eval traces.
-- See PLAN.md §3.4 / §3.5.
-- ============================================================

-- ── content_ideas ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_ideas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source        TEXT,                    -- 'signal' | 'trend' | 'inspiration' | 'manual'
  signal_id     UUID,                    -- optional link to signals.id
  platform      TEXT CHECK (platform IN ('linkedin', 'x', 'both')),
  angle         TEXT NOT NULL,
  hook          TEXT,
  rationale     TEXT,
  score         NUMERIC(5, 2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed', 'approved', 'rejected', 'drafted')),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_ideas_ws_status_idx ON content_ideas(workspace_id, status, created_at DESC);
ALTER TABLE content_ideas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_ideas_owner ON content_ideas;
CREATE POLICY content_ideas_owner ON content_ideas FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── posts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_id         UUID REFERENCES content_ideas(id) ON DELETE SET NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('linkedin', 'x')),
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'edited', 'scheduled', 'published', 'failed')),
  hook            TEXT,
  body            TEXT NOT NULL DEFAULT '',
  media           JSONB NOT NULL DEFAULT '[]'::jsonb,
  thread          JSONB,                   -- array of follow-on posts, if any
  eval_score      NUMERIC(5, 2),
  eval_failed     TEXT[] NOT NULL DEFAULT '{}',
  scheduled_at    TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  external_id     TEXT,                    -- platform post id
  partner_post_id TEXT,                    -- posting-partner job/post id
  partner         TEXT,                    -- 'typefully' | 'buffer' | 'ayrshare' | 'manual'
  metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {impressions, likes, comments, reposts, followers_delta, fetched_at}
  metrics_fetched_at TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_ws_status_idx ON posts(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_scheduled_idx ON posts(status, scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS posts_published_metrics_idx ON posts(status, metrics_fetched_at) WHERE status = 'published';
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS posts_owner ON posts;
CREATE POLICY posts_owner ON posts FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── social_accounts (posting partner connection) ──────────────
CREATE TABLE IF NOT EXISTS social_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner       TEXT NOT NULL CHECK (partner IN ('postforme', 'typefully', 'buffer', 'ayrshare', 'manual')),
  platform      TEXT CHECK (platform IN ('linkedin', 'x')),  -- null = partner manages all platforms
  display_name  TEXT,
  api_key       TEXT,                    -- partner API key (server-side only; not exposed by RLS-safe selects)
  external_account_id TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_ws_partner_platform_idx
  ON social_accounts(workspace_id, partner, COALESCE(platform, 'all'));
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS social_accounts_owner ON social_accounts;
CREATE POLICY social_accounts_owner ON social_accounts FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── workspace_llm_keys (BYO Claude / ChatGPT) ─────────────────
CREATE TABLE IF NOT EXISTS workspace_llm_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  api_key       TEXT NOT NULL,
  model         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_llm_keys_ws_provider_idx ON workspace_llm_keys(workspace_id, provider);
ALTER TABLE workspace_llm_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_llm_keys_owner ON workspace_llm_keys;
CREATE POLICY workspace_llm_keys_owner ON workspace_llm_keys FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── content eval traces ───────────────────────────────────────
-- Reuse gtm_eval_traces; widen the trace_type CHECK to include content types.
ALTER TABLE gtm_eval_traces DROP CONSTRAINT IF EXISTS gtm_eval_traces_trace_type_check;
ALTER TABLE gtm_eval_traces ADD CONSTRAINT gtm_eval_traces_trace_type_check CHECK (trace_type IN (
  'manual_outreach_send',
  'automation_send',
  'followup_send',
  'policy_simulation',
  'draft_quality',
  'content_post_quality',
  'content_engagement'
));
ALTER TABLE gtm_eval_traces ADD COLUMN IF NOT EXISTS post_id UUID;

-- Note: content "publish" is metered as an *outcome* via credit_ledger
-- (see lib/credits/outcomes.ts), not via agent_cost_catalog — the catalog is the
-- per-call cost model for external A2A agents drawing on their own wallet.
