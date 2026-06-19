-- Keep MCP access revocable and auditable from Profile.

alter table mcp_oauth_tokens
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by_user_id uuid;

create index if not exists mcp_oauth_tokens_active_user_idx
  on mcp_oauth_tokens(user_id, expires_at desc)
  where revoked_at is null;
