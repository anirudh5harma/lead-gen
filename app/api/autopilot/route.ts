import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { checkRateLimit } from '@/lib/rate-limit'
import { applyAutomationMode, buildReadiness, normalizeAutomationMode, type AutomationMode } from '@/lib/autopilot'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const [profileRes, accountsRes, policyRes, countsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, icp_keywords, target_industries, lead_credit_balance, automation_mode')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('connected_accounts')
      .select('id, provider, email, display_name, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true),
    getPolicy(supabase, user.id, activeClientId),
    leadCounts(supabase, user.id, activeClientId),
  ])

  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 })
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 })
  if (policyRes.error) return NextResponse.json({ error: policyRes.error.message }, { status: 500 })

  const profile = profileRes.data as {
    company_name?: string | null
    website_url?: string | null
    services_description?: string | null
    icp_keywords?: string[] | null
    target_industries?: string[] | null
    lead_credit_balance?: number | null
    automation_mode?: AutomationMode | null
  } | null
  const readiness = buildReadiness({
    hasProfile: Boolean(profile?.company_name && profile?.services_description),
    hasWebsite: Boolean(profile?.website_url),
    hasIcp: Boolean(profile?.icp_keywords?.length || profile?.target_industries?.length),
    hasInbox: Boolean(accountsRes.data?.length),
    hasCredits: (profile?.lead_credit_balance ?? 0) > 0,
  })

  return NextResponse.json({
    mode: profile?.automation_mode ?? 'approve_first',
    ready: readiness.every(item => item.done),
    readiness,
    connected_accounts: accountsRes.data ?? [],
    policy: policyRes.data ?? null,
    counts: countsRes,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await checkRateLimit(`autopilot-start:${user.id}`, 15, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many autopilot changes. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const body = await request.json().catch(() => null) as { mode?: unknown } | null
  const mode = normalizeAutomationMode(body?.mode)
  if (!mode) return NextResponse.json({ error: 'Invalid autopilot mode.' }, { status: 400 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const result = await applyAutomationMode(supabase, {
    userId: user.id,
    clientId: activeClientId,
    mode,
    userEmail: user.email ?? null,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, readiness: result.readiness },
      { status: result.status ?? 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    mode: result.mode,
    enabled: result.mode === 'autopilot',
    readiness: result.readiness,
  })
}

function getPolicy(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientId: string | null,
) {
  let query = supabase
    .from('auto_send_policies')
    .select('enabled, target_origins, min_relevance_score, daily_send_limit, min_minutes_between_sends')
    .eq('user_id', userId)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  return query.maybeSingle()
}

async function leadCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientId: string | null,
) {
  const scopedLeadCount = () => {
    let query = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
    return query
  }

  const [ready, sent, replied, booked] = await Promise.all([
    scopedLeadCount().in('status', ['drafted', 'viewed', 'new']).eq('is_unlocked', true).not('contact_email', 'is', null),
    scopedLeadCount().not('sent_at', 'is', null),
    scopedLeadCount().not('replied_at', 'is', null),
    scopedLeadCount().not('booked_at', 'is', null),
  ])

  return {
    ready: ready.count ?? 0,
    sent: sent.count ?? 0,
    replied: replied.count ?? 0,
    booked: booked.count ?? 0,
  }
}
