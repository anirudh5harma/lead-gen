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
    .select('company_name, website_url, services_description, icp_keywords, active_client_id, automation_mode')
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
    .select('plan, leads_used_this_month, lead_credit_balance, slack_webhook_url, slack_min_score')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: recentLeadCount } = await supabase.rpc('recent_lead_count', {
    p_user_id: user.id,
  })

  const leadsUsed        = recentLeadCount ?? (extProfile as { leads_used_this_month?: number } | null)?.leads_used_this_month ?? 0
  const leadCredits      = (extProfile as { lead_credit_balance?: number } | null)?.lead_credit_balance ?? 0
  const slackWebhookUrl  = (extProfile as { slack_webhook_url?: string | null } | null)?.slack_webhook_url ?? null
  const slackMinScore    = (extProfile as { slack_min_score?: number | null } | null)?.slack_min_score ?? 7

  const leadSelect = `
      id,
      client_id,
      origin,
      source_kind,
      source_record_id,
      feed_session_id,
      feed_session_label,
      feed_session_started_at,
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
      reply_intent,
      reply_summary,
      reply_body_snippet,
      reply_received_at,
      meeting_detected_at,
      booking_reply_sent_at,
      contact_email,
      contact_name,
      contact_title,
      feed_snapshot
    `

  const leadBaseFilter = activeClientId ? { client_id: activeClientId } : {}

  // Initial leads are loaded per origin so large Explore/CRM batches do not
  // evict live-signal rows from the server-rendered feed.
  const [liveLeadsResult, exploreLeadsResult, crmLeadsResult, agentEventsResult] = await Promise.all([
    supabase
      .from('leads')
      .select(leadSelect)
      .eq('user_id', user.id)
      .match(leadBaseFilter)
      .eq('origin', 'live')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('leads')
      .select(leadSelect)
      .eq('user_id', user.id)
      .match(leadBaseFilter)
      .eq('origin', 'explore')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('leads')
      .select(leadSelect)
      .eq('user_id', user.id)
      .match(leadBaseFilter)
      .eq('origin', 'crm_import')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('agent_events')
      .select('id, agent_name, event_type, status, title, body, lead_id, created_at')
      .eq('user_id', user.id)
      .match(leadBaseFilter)
      .order('created_at', { ascending: false })
      .limit(80),
  ])

  const leads = [
    ...(liveLeadsResult.data ?? []),
    ...(exploreLeadsResult.data ?? []),
    ...(crmLeadsResult.data ?? []),
  ].sort((a, b) => (
    new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  ))

  // Watchlist
  const { data: watchlist } = await supabase
    .from('watchlist_companies')
    .select('id, company_name, company_domain')
    .eq('user_id', user.id)
    .match(activeClientId ? { client_id: activeClientId } : {})
    .order('created_at', { ascending: false })

  const typedLeads = leads as unknown as Lead[]

  return (
    <DashboardShell
      initialLeads={typedLeads}
      initialAgentEvents={(agentEventsResult.data ?? []) as never}
      userId={user.id}
      userProfile={{
        company_name: profile.company_name,
        services_description: (clientProfile as { services_description?: string } | null)?.services_description ?? profile.services_description,
        website_url: (clientProfile as { website_url?: string | null } | null)?.website_url ?? (profile as { website_url?: string | null }).website_url ?? null,
        icp_keywords: (clientProfile as { icp_keywords?: string[] | null } | null)?.icp_keywords ?? profile.icp_keywords,
        email: user.email,
        plan: 'free',
        leads_used_this_month: leadsUsed,
        lead_credit_balance: leadCredits,
        slack_webhook_url: slackWebhookUrl,
        slack_min_score: slackMinScore,
        active_client_id: activeClientId,
        automation_mode: (profile as { automation_mode?: 'research_only' | 'approve_first' | 'autopilot' | null }).automation_mode ?? 'approve_first',
        client_name: (clientProfile as { name?: string } | null)?.name ?? profile.company_name,
      }}
      watchlist={watchlist ?? []}
    />
  )
}
