import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import {
  normalizeDailySendLimit,
  normalizeAutoSendPolicy,
  normalizePolicyAge,
  normalizePolicyScore,
  normalizeSendSpacing,
  sanitizeAutoSendOrigins,
  sanitizeSessionIds,
  normalizeExploreDailySendLimit,
} from '@/lib/auto-send-policies'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendAutomationLifecycleEmail } from '@/lib/resend'
import { requirePlan } from '@/lib/api-plan-guard'
import { simulateOutboundPolicy } from '@/lib/policies/outbound'
import { validateOutboundRecipients } from '@/lib/outbound-recipient-validation'

export async function GET() {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'growth')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck

  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const exploreSessionsQuery = activeClientId
    ? supabase
        .from('explore_runs')
        .select('id, prompt, generated_count, inserted_count, created_at, autopilot_status')
        .eq('user_id', userId)
        .eq('client_id', activeClientId)
        .order('created_at', { ascending: false })
        .limit(50)
    : supabase
        .from('explore_runs')
        .select('id, prompt, generated_count, inserted_count, created_at, autopilot_status')
        .eq('user_id', userId)
        .is('client_id', null)
        .order('created_at', { ascending: false })
        .limit(50)

  const [policyRes, accountsRes, exploreSessionsRes] = await Promise.all([
    activeClientId
      ? supabase
          .from('auto_send_policies')
          .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, explore_daily_send_limit, min_minutes_between_sends')
          .eq('user_id', userId)
          .eq('client_id', activeClientId)
          .maybeSingle()
      : supabase
          .from('auto_send_policies')
          .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, explore_daily_send_limit, min_minutes_between_sends')
          .eq('user_id', userId)
          .is('client_id', null)
          .maybeSingle(),
    supabase
      .from('connected_accounts')
      .select('id, provider, email, display_name, is_active, last_used_at, created_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    exploreSessionsQuery,
  ])

  if (policyRes.error) return NextResponse.json({ error: policyRes.error.message }, { status: 500 })
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 })

  const policy = normalizeAutoSendPolicy(policyRes.data ?? null)

  return NextResponse.json({
    policy,
    accounts: accountsRes.data ?? [],
    explore_sessions: (exploreSessionsRes.data ?? []).map(session => ({
      id: session.id,
      prompt: session.prompt,
      generated_count: session.generated_count,
      inserted_count: session.inserted_count,
      created_at: session.created_at,
      in_autopilot: policy.target_explore_session_ids.includes(session.id),
      autopilot_status: session.autopilot_status,
    })),
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'growth')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck

  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const body = await request.json().catch(() => null) as {
    enabled?: boolean
    connected_account_id?: string | null
    target_origins?: unknown
    target_explore_session_ids?: unknown
    require_verified_contact?: boolean
    min_relevance_score?: number
    max_lead_age_days?: number
    daily_send_limit?: number
    explore_daily_send_limit?: number
    min_minutes_between_sends?: number
  } | null

  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }

  const rl = await checkRateLimit(`automation-settings:${userId}`, 30, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many automation setting changes. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const targetOrigins = body.enabled
    ? sanitizeAutoSendOrigins(body.target_origins)
    : Array.isArray(body.target_origins)
      ? body.target_origins.filter((origin): origin is 'live' | 'explore' => origin === 'live' || origin === 'explore')
      : []
  const preflightOrigins = targetOrigins.filter((origin): origin is 'live' | 'explore' => origin === 'live' || origin === 'explore')
  const targetExploreSessionIds = sanitizeSessionIds(body.target_explore_session_ids)
  const requireVerifiedContact = body.require_verified_contact === true
  const minRelevanceScore = normalizePolicyScore(body.min_relevance_score)
  const maxLeadAgeDays = normalizePolicyAge(body.max_lead_age_days)
  const dailySendLimit = normalizeDailySendLimit(body.daily_send_limit)
  const exploreDailySendLimit = normalizeExploreDailySendLimit(body.explore_daily_send_limit)
  const minMinutesBetweenSends = normalizeSendSpacing(body.min_minutes_between_sends)
  const connectedAccountId = typeof body.connected_account_id === 'string' && body.connected_account_id.trim()
    ? body.connected_account_id.trim()
    : null

  if (body.enabled && targetOrigins.includes('explore') && targetExploreSessionIds.length === 0 && !targetOrigins.includes('live')) {
    return NextResponse.json({ error: 'Select at least one batch session or enable live automation.' }, { status: 400 })
  }

  if (connectedAccountId) {
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('id', connectedAccountId)
      .eq('is_active', true)
      .maybeSingle()

    if (accountError) return NextResponse.json({ error: accountError.message }, { status: 500 })
    if (!account) return NextResponse.json({ error: 'Connected inbox not found' }, { status: 400 })
  }

  if (body.enabled) {
    const accountQuery = supabase
      .from('connected_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
    const { data: activeAccounts, error: activeAccountError } = connectedAccountId
      ? await accountQuery.eq('id', connectedAccountId)
      : await accountQuery
    if (activeAccountError) return NextResponse.json({ error: activeAccountError.message }, { status: 500 })
    if (!activeAccounts?.length) {
      return NextResponse.json({ error: 'Connect a sending inbox before starting automation.' }, { status: 400 })
    }
  }

  let preflight: AutopilotPreflightResult | null = null
  if (body.enabled) {
    preflight = await runAutopilotPreflight({
      supabase,
      userId,
      clientId: activeClientId,
      targetOrigins: preflightOrigins,
      minRelevanceScore,
      maxLeadAgeDays,
      requireVerifiedContact,
    })
    if (preflight.status === 'fail') {
      return NextResponse.json({
        error: 'Autopilot preflight failed. Fix contact quality or policy blockers before enabling.',
        preflight,
      }, { status: 409 })
    }
  }

  const existingQuery = activeClientId
    ? supabase
        .from('auto_send_policies')
        .select('id')
        .eq('user_id', userId)
        .eq('client_id', activeClientId)
        .maybeSingle()
    : supabase
        .from('auto_send_policies')
        .select('id')
        .eq('user_id', userId)
        .is('client_id', null)
        .maybeSingle()

  const { data: existing, error: existingError } = await existingQuery
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  const wasEnabled = (existing as { enabled?: boolean | null } | null)?.enabled === true
  const nowIso = new Date().toISOString()

  const payload = {
    user_id: userId,
    client_id: activeClientId,
    enabled: body.enabled,
    connected_account_id: connectedAccountId,
    target_origins: targetOrigins,
    target_explore_session_ids: targetExploreSessionIds,
    require_verified_contact: requireVerifiedContact,
    min_relevance_score: minRelevanceScore,
    max_lead_age_days: maxLeadAgeDays,
    daily_send_limit: dailySendLimit,
    explore_daily_send_limit: exploreDailySendLimit,
    min_minutes_between_sends: minMinutesBetweenSends,
    ...(body.enabled && !wasEnabled
      ? {
          last_started_at: nowIso,
          last_completed_at: null,
          started_notification_sent_at: nowIso,
          completed_notification_sent_at: null,
        }
      : {}),
  }

  const response = existing
    ? await supabase
        .from('auto_send_policies')
        .update(payload)
        .eq('id', existing.id)
        .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, explore_daily_send_limit, min_minutes_between_sends')
        .single()
    : await supabase
        .from('auto_send_policies')
        .insert(payload)
        .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, explore_daily_send_limit, min_minutes_between_sends')
        .single()

  if (response.error) return NextResponse.json({ error: response.error.message }, { status: 500 })

  const userEmail = (await supabase.auth.getUser()).data.user?.email
  if (body.enabled && !wasEnabled && userEmail) {
    const summary = targetOrigins.includes('live')
      ? `Bombsell will safely send eligible unlocked live-signal leads, capped at ${dailySendLimit} sends/day with at least ${minMinutesBetweenSends} minutes between sends.`
      : `Bombsell will safely send eligible unlocked leads from ${targetExploreSessionIds.length} selected batch session${targetExploreSessionIds.length === 1 ? '' : 's'}, capped at ${dailySendLimit} sends/day.`
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('company_name')
      .eq('user_id', userId)
      .maybeSingle()
    sendAutomationLifecycleEmail({
      toEmail: userEmail,
      companyName: (profile as { company_name?: string | null } | null)?.company_name ?? 'your workspace',
      event: 'started',
      summary,
    }).catch(error => console.error('[auto-send] start notification failed:', error))
  }

  return NextResponse.json({
    ok: true,
    policy: normalizeAutoSendPolicy(response.data ?? null),
    preflight,
  })
}

interface AutopilotPreflightResult {
  status: 'pass' | 'fail' | 'no_eligible_leads'
  sampled: number
  passed: number
  blocked: number
  details: Array<{
    lead_id: string
    company: string
    passed: boolean
    reasons: string[]
    recipient_email: string | null
  }>
}

async function runAutopilotPreflight(input: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  clientId: string | null
  targetOrigins: Array<'live' | 'explore'>
  minRelevanceScore: number
  maxLeadAgeDays: number
  requireVerifiedContact: boolean
}): Promise<AutopilotPreflightResult> {
  const threshold = new Date(Date.now() - input.maxLeadAgeDays * 24 * 60 * 60 * 1000).toISOString()
  let query = input.supabase
    .from('leads')
    .select('id, target_company, company_domain, status, is_unlocked, relevance_score, created_at, contact_email, contact_verified, origin')
    .eq('user_id', input.userId)
    .eq('is_unlocked', true)
    .gte('relevance_score', input.minRelevanceScore)
    .gte('created_at', threshold)
    .in('status', ['new', 'viewed', 'drafted'])
    .order('created_at', { ascending: false })
    .limit(6)

  query = input.clientId
    ? query.eq('client_id', input.clientId)
    : query.is('client_id', null)
  if (input.targetOrigins.length === 1) query = query.eq('origin', input.targetOrigins[0])

  const { data: leads, error } = await query
  if (error) {
    console.error('[auto-send] preflight query failed:', error.message)
    return { status: 'no_eligible_leads', sampled: 0, passed: 0, blocked: 0, details: [] }
  }

  const details: AutopilotPreflightResult['details'] = []
  for (const lead of leads ?? []) {
    const recipientEmail = typeof lead.contact_email === 'string' ? lead.contact_email.trim().toLowerCase() : null
    const reasons: string[] = []
    let passed = false
    if (!recipientEmail) {
      reasons.push('missing_recipient')
    } else {
      const validation = await validateOutboundRecipients([recipientEmail], { maxCacheAgeDays: 3 })
      const decision = await simulateOutboundPolicy(input.supabase, {
        userId: input.userId,
        clientId: input.clientId,
        leadId: lead.id,
        targetCompany: lead.target_company,
        companyDomain: lead.company_domain,
        status: lead.status,
        isUnlocked: lead.is_unlocked,
        contactVerified: lead.contact_verified,
        recipientValidationSafe: validation.safe,
        recipientEmails: [recipientEmail],
        requireVerifiedContact: input.requireVerifiedContact,
        metadata: { preflight: true },
      })
      reasons.push(...decision.reasons)
      if (!validation.safe) reasons.push(...validation.reasons)
      passed = decision.decision === 'allowed' && validation.safe
    }

    details.push({
      lead_id: lead.id,
      company: lead.target_company,
      passed,
      reasons: [...new Set(reasons)],
      recipient_email: recipientEmail,
    })
  }

  if (details.length === 0) {
    return { status: 'no_eligible_leads', sampled: 0, passed: 0, blocked: 0, details: [] }
  }

  const passed = details.filter(item => item.passed).length
  const blocked = details.length - passed
  return {
    status: passed > 0 ? 'pass' : 'fail',
    sampled: details.length,
    passed,
    blocked,
    details,
  }
}
