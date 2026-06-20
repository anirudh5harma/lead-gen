-- 041_workspace_billing_subscription.sql
-- Workspace-scoped Dodo subscription state for the Pro plan. Webhooks emit
-- workspace.billing.subscription.synced and project the latest state here.

alter table workspaces
  add column if not exists subscription_status text not null default 'inactive'
    check (subscription_status in ('active', 'canceled', 'expired', 'inactive')),
  add column if not exists subscription_period text
    check (subscription_period in ('monthly', 'annual')),
  add column if not exists subscription_external_id text,
  add column if not exists subscription_product_id text,
  add column if not exists dodo_customer_id text,
  add column if not exists subscription_current_period_start_at timestamptz,
  add column if not exists subscription_renews_at timestamptz,
  add column if not exists subscription_cancelled_at timestamptz,
  add column if not exists subscription_updated_at timestamptz;

create index if not exists workspaces_subscription_external_id_idx
  on workspaces (subscription_external_id)
  where subscription_external_id is not null;

create index if not exists workspaces_dodo_customer_id_idx
  on workspaces (dodo_customer_id)
  where dodo_customer_id is not null;
