-- 044_trial_credits.sql
-- Trial credits for workspace-scoped outreach entitlement. Trial sends are
-- metered append-only in a billing ledger; Pro remains unlimited.

alter table workspaces
  add column if not exists trial_credits_remaining integer not null default 15,
  add column if not exists trial_credits_total integer not null default 15,
  add column if not exists credits_exhausted_at timestamptz,
  add column if not exists trial_reminder_low_sent_at timestamptz,
  add column if not exists trial_reminder_zero_sent_at timestamptz,
  add column if not exists trial_reminder_week_sent_at timestamptz;

create table if not exists billing_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  channel text not null check (channel in ('email', 'linkedin')),
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('trial_grant', 'consume', 'refund')),
  created_at timestamptz not null default now()
);

create index if not exists billing_credit_ledger_workspace_created_idx
  on billing_credit_ledger (workspace_id, created_at desc);

create unique index if not exists billing_credit_ledger_consume_once_idx
  on billing_credit_ledger (workspace_id, message_id)
  where reason = 'consume';

create unique index if not exists billing_credit_ledger_refund_once_idx
  on billing_credit_ledger (workspace_id, message_id)
  where reason = 'refund';

create unique index if not exists billing_credit_ledger_trial_grant_once_idx
  on billing_credit_ledger (workspace_id)
  where reason = 'trial_grant';
