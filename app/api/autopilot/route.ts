import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { checkRateLimit } from '@/lib/rate-limit'
import { recordAgentEvent } from '@/lib/agent-events'
import { sendAutomationLifecycleEmail } from '@/lib/resend'

type AutomationMode = 'research_only' | 'approve_first' | 'autopilot'

const DEFAULT_AUTOPILOT = {
  target_origins: ['live'] as const,
  require_verified_contact: true,
  min_relevance_score: 7,
  max_lead_age_days: 30,
  daily_send_limit: 10,
  min_minutes_between_sends: 30,
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const [profileRes, accountsRes, policyRes, countsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, icp_keywords, lead_credit_balance, automation_mode')
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
    lead_credit_balance?: number | null
    automation_mode?: AutomationMode | null
  } | null
  const readiness = buildReadiness({
    hasProfile: Boolean(profile?.company_name && profile?.services_description),
    hasWebsite: Boolean(profile?.website_url),
    hasIcp: Boolean(profile?.icp_keywords?.length),
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
  const mode = normalizeMode(body?.mode)
  if (!mode) return NextResponse.json({ error: 'Invalid autopilot mode.' }, { status: 400 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const [profileRes, accountsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, icp_keywords, lead_credit_balance')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('connected_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1),
  ])

  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 })
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 })

  const profile = profileRes.data as {
    company_name?: string | null
    website_url?: string | null
    services_description?: string | null
    icp_keywords?: string[] | null
    lead_credit_balance?: number | null
  } | null
  const readiness = buildReadiness({
    hasProfile: Boolean(profile?.company_name && profile?.services_description),
    hasWebsite: Boolean(profile?.website_url),
    hasIcp: Boolean(profile?.icp_keywords?.length),
    hasInbox: Boolean(accountsRes.data?.length),
    hasCredits: (profile?.lead_credit_balance ?? 0) > 0,
  })

  if (mode === 'autopilot' && readiness.some(item => !item.done)) {
    return NextResponse.json({
      error: 'Finish the launch checklist before starting autopilot.',
      readiness,
    }, { status: 400 })
  }

  const existingPolicyQuery = activeClientId
    ? supabase
        .from('auto_send_policies')
        .select('id')
        .eq('user_id', user.id)
        .eq('client_id', activeClientId)
        .maybeSingle()
    : supabase
        .from('auto_send_policies')
        .select('id')
        .eq('user_id', user.id)
        .is('client_id', null)
        .maybeSingle()
  const { data: existingPolicy, error: existingPolicyError } = await existingPolicyQuery
  if (existingPolicyError) return NextResponse.json({ error: existingPolicyError.message }, { status: 500 })

  const now = new Date().toISOString()
  const enabled = mode === 'autopilot'
  const policyPayload = {
    user_id: user.id,
    client_id: activeClientId,
    enabled,
    connected_account_id: null,
    ...DEFAULT_AUTOPILOT,
    last_started_at: enabled ? now : null,
    last_completed_at: null,
    started_notification_sent_at: enabled ? now : null,
    completed_notification_sent_at: null,
  }
  const [profileUpdate, policyUpdate] = await Promise.all([
    supabase
      .from('user_profiles')
      .update({ automation_mode: mode })
      .eq('user_id', user.id),
    existingPolicy
      ? supabase
          .from('auto_send_policies')
          .update(policyPayload)
          .eq('id', existingPolicy.id)
      : supabase
          .from('auto_send_policies')
          .insert(policyPayload),
  ])

  if (profileUpdate.error) return NextResponse.json({ error: profileUpdate.error.message }, { status: 500 })
  if (policyUpdate.error) return NextResponse.json({ error: policyUpdate.error.message }, { status: 500 })

  await recordAgentEvent(supabase, {
    userId: user.id,
    clientId: activeClientId,
    agentName: 'operator',
    eventType: 'autopilot_mode_changed',
    status: enabled ? 'running' : 'completed',
    title: enabled ? 'Autopilot started' : `Mode changed to ${mode.replace('_', ' ')}`,
    body: enabled
      ? 'Bombsell will now run safe verified-contact outbound from the live signal feed.'
      : 'Bombsell saved the operating mode. Autopilot sending is not active in this mode.',
    metadata: { mode },
  })

  if (enabled && user.email) {
    sendAutomationLifecycleEmail({
      toEmail: user.email,
      companyName: profile?.company_name ?? 'your workspace',
      event: 'started',
      summary: 'Bombsell autopilot is active. Agents will find matching leads, use verified contacts only, send with mailbox pacing, stop on replies, and surface outcomes in Command Center.',
    }).catch(error => console.error('[autopilot] start email failed:', error))
  }

  return NextResponse.json({
    ok: true,
    mode,
    enabled,
    readiness,
  })
}

function normalizeMode(value: unknown): AutomationMode | null {
  return value === 'research_only' || value === 'approve_first' || value === 'autopilot'
    ? value
    : null
}

function buildReadiness(input: {
  hasProfile: boolean
  hasWebsite: boolean
  hasIcp: boolean
  hasInbox: boolean
  hasCredits: boolean
}) {
  return [
    { key: 'profile', label: 'Offer and company profile', done: input.hasProfile, action: 'Edit onboarding' },
    { key: 'website', label: 'Website for personalization', done: input.hasWebsite, action: 'Add website' },
    { key: 'icp', label: 'ICP keywords', done: input.hasIcp, action: 'Tune ICP' },
    { key: 'inbox', label: 'Connected Gmail or Outlook', done: input.hasInbox, action: 'Connect inbox' },
    { key: 'credits', label: 'Lead unlock credits', done: input.hasCredits, action: 'Add credits' },
  ]
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
