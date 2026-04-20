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
    .select('company_name, services_description, icp_keywords')
    .eq('user_id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  // Migration-004 fields — may not exist yet; use defaults if the query errors.
  const { data: extProfile } = await supabase
    .from('user_profiles')
    .select('plan, leads_used_this_month, slack_webhook_url, auto_send_enabled')
    .eq('user_id', user.id)
    .maybeSingle()

  const plan             = (extProfile as { plan?: string } | null)?.plan ?? 'free'
  const leadsUsed        = (extProfile as { leads_used_this_month?: number } | null)?.leads_used_this_month ?? 0
  const slackWebhookUrl  = (extProfile as { slack_webhook_url?: string | null } | null)?.slack_webhook_url ?? null
  const autoSendEnabled  = (extProfile as { auto_send_enabled?: boolean } | null)?.auto_send_enabled ?? false

  // Initial leads (server-rendered)
  const { data: leads } = await supabase
    .from('leads')
    .select(`
      id,
      target_company,
      relevance_score,
      relevance_reason,
      status,
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
        published_at,
        company_domain
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  // Watchlist
  const { data: watchlist } = await supabase
    .from('watchlist_companies')
    .select('id, company_name, company_domain')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const typedLeads = (leads ?? []) as unknown as Lead[]

  return (
    <DashboardShell
      initialLeads={typedLeads}
      userId={user.id}
      userProfile={{
        company_name: profile.company_name,
        services_description: profile.services_description,
        icp_keywords: profile.icp_keywords,
        email: user.email,
        plan: plan,
        leads_used_this_month: leadsUsed,
        slack_webhook_url: slackWebhookUrl,
        auto_send_enabled: autoSendEnabled,
      }}
      watchlist={watchlist ?? []}
    />
  )
}
