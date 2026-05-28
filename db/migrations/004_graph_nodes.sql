-- 004_graph_nodes.sql
-- Knowledge graph node tables. Persons, companies, sources. Every node has:
--   * a workspace_id (tenant boundary)
--   * a typed `properties jsonb` for open-ended attributes
--   * a `provenance jsonb` recording which agent/source produced or last-touched it
--   * an `embedding` for hybrid retrieval (BM25 + vector + graph proximity)
--
-- Vector dimension is 1536 (e.g. text-embedding-3-small). Change here if a
-- different model becomes the default — and migrate existing rows.

-- Companies ------------------------------------------------------------------

create table graph_companies (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,

  name              text not null,
  domain            citext,
  industry          text,
  size_bucket       text,                     -- e.g. '1-10', '11-50', '51-200', '201-500', '500+'
  description       text,

  properties        jsonb not null default '{}'::jsonb,
  provenance        jsonb not null default '{}'::jsonb,

  embedding         vector(1536),
  embedded_at       timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index graph_companies_workspace_domain_idx
  on graph_companies (workspace_id, domain)
  where domain is not null;

create index graph_companies_workspace_name_idx
  on graph_companies (workspace_id, lower(name));

create index graph_companies_properties_gin_idx
  on graph_companies using gin (properties);

create index graph_companies_embedding_idx
  on graph_companies using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Persons --------------------------------------------------------------------

create table graph_persons (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,

  full_name         text not null,
  given_name        text,
  family_name       text,
  title             text,
  company_id        uuid references graph_companies(id) on delete set null,

  -- Channel handles. Arrays let us track historical handles without losing data.
  emails            citext[] not null default array[]::citext[],
  phones            text[]   not null default array[]::text[],
  linkedin_url      text,
  x_handle          citext,

  properties        jsonb not null default '{}'::jsonb,
  provenance        jsonb not null default '{}'::jsonb,

  embedding         vector(1536),
  embedded_at       timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index graph_persons_workspace_company_idx
  on graph_persons (workspace_id, company_id);

create index graph_persons_workspace_name_idx
  on graph_persons (workspace_id, lower(full_name));

-- Email lookup. GIN on the citext[] supports `emails @> array['foo@bar']::citext[]`.
create index graph_persons_emails_gin_idx
  on graph_persons using gin (emails);

create index graph_persons_linkedin_idx
  on graph_persons (workspace_id, linkedin_url)
  where linkedin_url is not null;

create index graph_persons_properties_gin_idx
  on graph_persons using gin (properties);

create index graph_persons_embedding_idx
  on graph_persons using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Sources --------------------------------------------------------------------
-- Where signals and content inspiration come from: GDELT queries, RSS feeds,
-- HN, Product Hunt, owned-domain monitors, podcast feeds, etc.

create type source_kind as enum (
  'gdelt',
  'hn',
  'product_hunt',
  'rss',
  'job_board',
  'web_monitor',
  'podcast',
  'newsletter',
  'manual',
  'other'
);

create table graph_sources (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,

  kind              source_kind not null,
  name              text not null,
  config            jsonb not null default '{}'::jsonb,    -- query string, feed URL, etc.

  enabled           boolean not null default true,
  last_polled_at    timestamptz,

  properties        jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now()
);

create index graph_sources_workspace_kind_idx
  on graph_sources (workspace_id, kind);
