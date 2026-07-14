-- 047_restate_workflow_approvals.sql
-- Restate invocation ids are opaque strings, not workflow_runs UUIDs. Approval
-- gates remain first-class projections, but may point at either runtime.

set local lock_timeout = '5s';

alter table workflow_approvals
  add column local_run_id uuid;

update workflow_approvals
   set local_run_id = run_id;

alter table workflow_approvals
  add constraint workflow_approvals_local_run_id_fkey
  foreign key (local_run_id) references workflow_runs(id) on delete cascade;

alter table workflow_approvals
  drop constraint workflow_approvals_run_id_fkey;

alter table workflow_approvals
  alter column id drop default,
  alter column id type text using id::text,
  alter column id set default gen_random_uuid()::text,
  alter column run_id type text using run_id::text;

create function sync_workflow_approval_local_run_id()
returns trigger
language plpgsql
as $$
begin
  if new.local_run_id is null
     and new.run_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and exists (select 1 from workflow_runs where id = new.run_id::uuid)
  then
    new.local_run_id := new.run_id::uuid;
  end if;
  return new;
end;
$$;

create trigger workflow_approvals_sync_local_run_id
before insert or update of run_id on workflow_approvals
for each row execute function sync_workflow_approval_local_run_id();

create index if not exists workflow_approvals_run_kind_idx
  on workflow_approvals (run_id, kind, created_at);

create index workflow_approvals_local_run_fk_idx
  on workflow_approvals (local_run_id)
  where local_run_id is not null;

comment on column workflow_approvals.run_id is
  'Opaque durable-runtime invocation id (Postgres workflow UUID or Restate invocation id).';

comment on column workflow_approvals.id is
  'Opaque approval gate id (Postgres UUID or Restate awakeable id).';
