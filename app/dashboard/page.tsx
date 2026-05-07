import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { getUserWorkspaceMemberships } from '@/lib/team'
import type { Lead } from '@/lib/leads'

export const revalidate = 0

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')
  const userId = user.id

  // Core fields — these exist from migration 001. Used to gate the onboarding redirect.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_name, website_url, services_description, icp_keywords, target_industries, active_client_id, automation_mode')
    .eq('user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')

  const activeClientId = (profile as { active_client_id?: string | null }).active_client_id ?? null

  const { data: clientProfile } = activeClientId
    ? await supabase
        .from('client_accounts')
        .select('id, name, website_url, services_description, icp_keywords')
        .eq('id', activeClientId)
        .maybeSingle()
    : { data: null }

  // Migration-004+056 fields — may not exist yet; use defaults if the query errors.
  const { data: extProfile } = await supabase
    .from('user_profiles')
    .select('plan, leads_used_this_month, leads_reset_at, lead_credit_balance, subscription_status, subscription_period, subscription_renews_at, slack_webhook_url, slack_min_score')
    .eq('user_id', userId)
    .maybeSingle()

  const workspaces = await getUserWorkspaceMemberships(supabase, userId)

  const leadsUsed        = (extProfile as { leads_used_this_month?: number } | null)?.leads_used_this_month ?? 0
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

  function leadQueryForOrigin(origin: 'live' | 'explore' | 'crm_import') {
    let query = supabase
      .from('leads')
      .select(leadSelect)
      .eq('origin', origin)
      .order('created_at', { ascending: false })
      .limit(200)

    query = activeClientId
      ? query.eq('client_id', activeClientId)
      : query.eq('user_id', userId)

    return query
  }

  // Initial account work is loaded per origin so large imported sources do not
  // evict live-signal rows from the server-rendered work view.
  const [liveLeadsResult, exploreLeadsResult, crmLeadsResult] = await Promise.all([
    leadQueryForOrigin('live'),
    leadQueryForOrigin('explore'),
    leadQueryForOrigin('crm_import'),
  ])

  const leads = [
    ...(liveLeadsResult.data ?? []),
    ...(exploreLeadsResult.data ?? []),
    ...(crmLeadsResult.data ?? []),
  ].sort((a, b) => (
    new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  ))

  const typedLeads = leads as unknown as Lead[]

  return (
    <DashboardShell
      initialLeads={typedLeads}
      userProfile={{
        company_name: profile.company_name,
        services_description: (clientProfile as { services_description?: string } | null)?.services_description ?? profile.services_description,
        website_url: (clientProfile as { website_url?: string | null } | null)?.website_url ?? (profile as { website_url?: string | null }).website_url ?? null,
        icp_keywords: (clientProfile as { icp_keywords?: string[] | null } | null)?.icp_keywords ?? profile.icp_keywords,
        target_industries: (clientProfile as { target_industries?: string[] | null } | null)?.target_industries ?? (profile as { target_industries?: string[] | null }).target_industries ?? [],
        email: user.email,
        plan: (extProfile as { plan?: string } | null)?.plan ?? 'free',
        leads_used_this_month: leadsUsed,
        leads_reset_at: (extProfile as { leads_reset_at?: string | null } | null)?.leads_reset_at ?? null,
        lead_credit_balance: leadCredits,
        subscription_status: (extProfile as { subscription_status?: 'none' | 'active' | 'canceled' | 'past_due' } | null)?.subscription_status ?? 'none',
        subscription_period: (extProfile as { subscription_period?: 'monthly' | 'annual' | null } | null)?.subscription_period ?? null,
        subscription_renews_at: (extProfile as { subscription_renews_at?: string | null } | null)?.subscription_renews_at ?? null,
        slack_webhook_url: slackWebhookUrl,
        slack_min_score: slackMinScore,
        active_client_id: activeClientId,
        automation_mode: (profile as { automation_mode?: 'research_only' | 'approve_first' | 'autopilot' | null }).automation_mode ?? 'approve_first',
        client_name: (clientProfile as { name?: string } | null)?.name ?? profile.company_name,
        workspaces,
      }}
    />
  )
}
