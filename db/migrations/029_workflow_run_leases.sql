-- 016_workflow_run_leases.sql
-- Worker leases prevent two worker processes from resuming the same journaled
-- workflow run at the same time. Leases are intentionally short-lived; a crash
-- is recovered by expiry and the next worker claim.

alter table workflow_runs
  add column lease_owner text,
  add column lease_expires_at timestamptz;

create index workflow_runs_runnable_lease_idx
  on workflow_runs (workflow_name, status, lease_expires_at, created_at)
  where status in ('running', 'awaiting_approval', 'awaiting_event');
