import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import type { Lead } from '@/components/LeadFeed'

export const revalidate = 0

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  // Core fields — these exist from migration 001. Used to gate the onboarding redirect.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_name, website_url, services_description, icp_keywords, active_client_id')
    .eq('user_id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  const activeClientId = (profile as { active_client_id?: string | null }).active_client_id ?? null

  const { data: clientProfile } = activeClientId
    ? await supabase
        .from('client_accounts')
        .select('id, name, website_url, services_description, icp_keywords')
        .eq('id', activeClientId)
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null }

  // Migration-004 fields — may not exist yet; use defaults if the query errors.
  const { data: extProfile } = await supabase
    .from('user_profiles')
    .select('plan, leads_used_this_month, slack_webhook_url, auto_send_enabled, allow_lead_overage')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: recentLeadCount } = await supabase.rpc('recent_lead_count', {
    p_user_id: user.id,
  })

  const plan             = (extProfile as { plan?: string } | null)?.plan ?? 'free'
  const leadsUsed        = recentLeadCount ?? (extProfile as { leads_used_this_month?: number } | null)?.leads_used_this_month ?? 0
  const slackWebhookUrl  = (extProfile as { slack_webhook_url?: string | null } | null)?.slack_webhook_url ?? null
  const autoSendEnabled  = (extProfile as { auto_send_enabled?: boolean } | null)?.auto_send_enabled ?? false
  const allowLeadOverage = (extProfile as { allow_lead_overage?: boolean } | null)?.allow_lead_overage ?? false

  // Initial leads (server-rendered)
  const { data: leads } = await supabase
    .from('leads')
    .select(`
      id,
      client_id,
      origin,
      target_company,
      company_domain,
      relevance_score,
      relevance_reason,
      status,
      is_unlocked,
      unlocked_at,
      created_at,
      sent_at,
      replied_at,
      booked_at,
      signals (
        signal_type,
        headline,
        summary,
        funding_amount,
        source_url,
        source_name,
        published_at,
        company_domain
      )
    `)
    .eq('user_id', user.id)
    .match(activeClientId ? { client_id: activeClientId } : {})
    .order('created_at', { ascending: false })
    .limit(200)

  // Watchlist
  const { data: watchlist } = await supabase
    .from('watchlist_companies')
    .select('id, company_name, company_domain')
    .eq('user_id', user.id)
    .match(activeClientId ? { client_id: activeClientId } : {})
    .order('created_at', { ascending: false })

  const typedLeads = (leads ?? []) as unknown as Lead[]

  return (
    <DashboardShell
      initialLeads={typedLeads}
      userId={user.id}
      userProfile={{
        company_name: profile.company_name,
        services_description: (clientProfile as { services_description?: string } | null)?.services_description ?? profile.services_description,
        website_url: (clientProfile as { website_url?: string | null } | null)?.website_url ?? (profile as { website_url?: string | null }).website_url ?? null,
        icp_keywords: (clientProfile as { icp_keywords?: string[] | null } | null)?.icp_keywords ?? profile.icp_keywords,
        email: user.email,
        plan: plan,
        leads_used_this_month: leadsUsed,
        slack_webhook_url: slackWebhookUrl,
        auto_send_enabled: autoSendEnabled,
        allow_lead_overage: allowLeadOverage,
        active_client_id: activeClientId,
        client_name: (clientProfile as { name?: string } | null)?.name ?? profile.company_name,
      }}
      watchlist={watchlist ?? []}
    />
  )
}
