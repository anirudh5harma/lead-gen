-- 011_channel_accounts.sql
-- Channel accounts: the connected identities a Rep uses to talk. Two kinds
-- of sending infrastructure live here:
--
--   * User-connected accounts (OAuth Gmail / Outlook, LinkedIn session, X OAuth)
--     - Volume capped to protect personal reputation. High-touch / founder-led.
--
--   * Owned sending infrastructure (workspace-managed domains with full
--     SPF/DKIM/DMARC, AWS SES / Postmark backend, warmup curves)
--     - Volume backbone for cold outreach. Reputation managed by the platform.

create type channel_account_kind as enum (
  'email_oauth',         -- user's connected Gmail / Outlook
  'email_domain',        -- workspace-owned sending domain
  'linkedin_session',
  'linkedin_oauth',
  'x_oauth',
  'voice_provider',
  'video_provider',
  'crm',
  'social_publisher',
  'other'
);

create type channel_account_status as enum (
  'connected',
  'needs_reauth',
  'rate_limited',
  'suspended',
  'disconnected'
);

create table channel_accounts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,

  kind              channel_account_kind not null,
  display_name      text not null,            -- 'anirudh@bombsell.com', 'go.bombsell.com', 'Maya LinkedIn'

  -- Encrypted credentials (envelope-encrypted via the workspace KMS key, see
  -- core/substrate/auth/). Never returned by default queries.
  credentials       jsonb,

  status            channel_account_status not null default 'connected',
  last_used_at      timestamptz,
  last_error        jsonb,

  -- Per-account daily volume cap. The deliverability subsystem reduces this
  -- live when complaint/bounce thresholds are crossed.
  daily_cap         integer,
  daily_used        integer not null default 0,
  daily_window_start timestamptz,

  properties        jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now()
);

create index channel_accounts_workspace_kind_idx
  on channel_accounts (workspace_id, kind, status);

create index channel_accounts_lru_idx
  on channel_accounts (workspace_id, kind, last_used_at nulls first)
  where status = 'connected';

-- Wire the messages.channel_account_id FK now that channel_accounts exists.
alter table messages
  add constraint messages_channel_account_id_fk
  foreign key (channel_account_id) references channel_accounts(id) on delete set null;

-- Owned sending domains ------------------------------------------------------
-- Sits alongside channel_accounts (kind='email_domain') with the volume /
-- reputation state machine the deliverability subsystem manages.

create type domain_warmup_state as enum (
  'unverified',
  'verifying',
  'warming',
  'warmed',
  'degraded',            -- reputation hit; throttled
  'frozen'               -- bounce/complaint thresholds breached
);

create table sending_domains (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  channel_account_id    uuid not null references channel_accounts(id) on delete cascade,

  domain                citext not null,

  spf_verified          boolean not null default false,
  dkim_verified         boolean not null default false,
  dmarc_verified        boolean not null default false,

  warmup_state          domain_warmup_state not null default 'unverified',
  warmup_day            integer not null default 0,        -- day-N of the warmup curve
  current_daily_cap     integer not null default 0,
  target_daily_cap      integer not null default 0,

  bounce_rate_24h       numeric(5,4) not null default 0,
  complaint_rate_24h    numeric(5,4) not null default 0,

  properties            jsonb not null default '{}'::jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index sending_domains_workspace_domain_idx
  on sending_domains (workspace_id, domain);

create index sending_domains_workspace_state_idx
  on sending_domains (workspace_id, warmup_state);
