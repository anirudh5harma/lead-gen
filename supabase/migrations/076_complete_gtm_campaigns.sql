-- Complete Campaigns as a user-facing GTM orchestration object, not just a list.
-- These nullable fields extend the existing 048 table safely for deployed workspaces.

alter table public.gtm_campaigns
  add column if not exists objective text null,
  add column if not exists offer text null,
  add column if not exists success_metric text null,
  add column if not exists channels text[] not null default array['email', 'linkedin', 'content']::text[],
  add column if not exists starts_at timestamptz null,
  add column if not exists ends_at timestamptz null,
  add column if not exists learnings jsonb not null default '{}'::jsonb;

create index if not exists gtm_campaigns_user_client_updated_idx
  on public.gtm_campaigns(user_id, client_id, updated_at desc);

-- 075 created bridge rows. Add updated_at triggers if the shared function exists.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at') then
    drop trigger if exists gtm_campaign_targets_updated_at on public.gtm_campaign_targets;
    create trigger gtm_campaign_targets_updated_at
      before update on public.gtm_campaign_targets
      for each row execute function update_updated_at();

    drop trigger if exists gtm_campaign_content_links_updated_at on public.gtm_campaign_content_links;
    create trigger gtm_campaign_content_links_updated_at
      before update on public.gtm_campaign_content_links
      for each row execute function update_updated_at();
  end if;
end $$;
