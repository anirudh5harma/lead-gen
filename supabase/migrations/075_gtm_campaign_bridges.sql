-- GTM campaigns become the orchestration layer that ties existing
-- outbound leads and content objects together without rewriting either engine.

create table if not exists public.gtm_campaign_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.gtm_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid null references public.client_accounts(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  status text not null default 'enrolled' check (status in ('proposed', 'enrolled', 'drafted', 'approved', 'sent', 'replied', 'booked', 'dismissed', 'blocked')),
  rationale text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create index if not exists gtm_campaign_targets_user_idx on public.gtm_campaign_targets(user_id, created_at desc);
create index if not exists gtm_campaign_targets_client_idx on public.gtm_campaign_targets(client_id, created_at desc) where client_id is not null;
create index if not exists gtm_campaign_targets_lead_idx on public.gtm_campaign_targets(lead_id);
create index if not exists gtm_campaign_targets_status_idx on public.gtm_campaign_targets(campaign_id, status);

create table if not exists public.gtm_campaign_content_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.gtm_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid null references public.client_accounts(id) on delete cascade,
  content_idea_id uuid null references public.content_ideas(id) on delete set null,
  post_id uuid null references public.posts(id) on delete set null,
  gtm_content_idea_id uuid null references public.gtm_content_ideas(id) on delete set null,
  gtm_campaign_asset_id uuid null references public.gtm_campaign_assets(id) on delete set null,
  channel text not null default 'linkedin',
  status text not null default 'linked' check (status in ('linked', 'drafted', 'approved', 'scheduled', 'published', 'dismissed')),
  rationale text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (content_idea_id is not null or post_id is not null or gtm_content_idea_id is not null or gtm_campaign_asset_id is not null)
);

create index if not exists gtm_campaign_content_links_user_idx on public.gtm_campaign_content_links(user_id, created_at desc);
create index if not exists gtm_campaign_content_links_client_idx on public.gtm_campaign_content_links(client_id, created_at desc) where client_id is not null;
create index if not exists gtm_campaign_content_links_campaign_idx on public.gtm_campaign_content_links(campaign_id, status);
create unique index if not exists gtm_campaign_content_links_content_idea_unique on public.gtm_campaign_content_links(campaign_id, content_idea_id) where content_idea_id is not null;
create unique index if not exists gtm_campaign_content_links_post_unique on public.gtm_campaign_content_links(campaign_id, post_id) where post_id is not null;
create unique index if not exists gtm_campaign_content_links_gtm_idea_unique on public.gtm_campaign_content_links(campaign_id, gtm_content_idea_id) where gtm_content_idea_id is not null;
create unique index if not exists gtm_campaign_content_links_asset_unique on public.gtm_campaign_content_links(campaign_id, gtm_campaign_asset_id) where gtm_campaign_asset_id is not null;

alter table public.gtm_campaign_targets enable row level security;
alter table public.gtm_campaign_content_links enable row level security;

drop policy if exists "Users manage own campaign targets" on public.gtm_campaign_targets;
create policy "Users manage own campaign targets" on public.gtm_campaign_targets
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own campaign content links" on public.gtm_campaign_content_links;
create policy "Users manage own campaign content links" on public.gtm_campaign_content_links
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
