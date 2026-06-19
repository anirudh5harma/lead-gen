-- OAuth state for hosted MCP clients such as Claude Code.

create table if not exists mcp_oauth_clients (
  client_id                  text primary key,
  client_name                text,
  redirect_uris              text[] not null,
  token_endpoint_auth_method text not null default 'none',
  created_at                 timestamptz not null default now()
);

create table if not exists mcp_oauth_codes (
  code_hash             text primary key,
  client_id             text not null references mcp_oauth_clients(client_id) on delete cascade,
  user_id               uuid not null,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  scope                 text,
  expires_at            timestamptz not null,
  used_at               timestamptz,
  created_at            timestamptz not null default now()
);

create table if not exists mcp_oauth_tokens (
  token_hash    text primary key,
  user_id       uuid not null,
  client_id     text references mcp_oauth_clients(client_id) on delete set null,
  scope         text,
  expires_at    timestamptz not null,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

alter table mcp_oauth_clients enable row level security;
alter table mcp_oauth_codes enable row level security;
alter table mcp_oauth_tokens enable row level security;

create index if not exists mcp_oauth_codes_client_expires_idx
  on mcp_oauth_codes(client_id, expires_at desc);

create index if not exists mcp_oauth_tokens_user_expires_idx
  on mcp_oauth_tokens(user_id, expires_at desc);
