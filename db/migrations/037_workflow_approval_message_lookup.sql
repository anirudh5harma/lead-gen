-- Speed up conversation/review surfaces that attach pending approvals to messages.
-- The approval payload remains event-shaped JSON, but message lookups need a stable index.

create index if not exists workflow_approvals_pending_message_idx
  on workflow_approvals (workspace_id, (payload->>'message_id'), created_at desc)
  where decision = 'pending'
    and payload ? 'message_id';
