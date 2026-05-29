-- 034_channel_accounts_updated_at.sql
-- Channel account projectors update this timestamp whenever provider or
-- deliverability state is materialized from typed events.

alter table channel_accounts
  add column if not exists updated_at timestamptz not null default now();
