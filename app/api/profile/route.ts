import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { embed, toVectorLiteral } from '@/lib/embeddings'
import { extractICPKeywords } from '@/lib/deepseek'
import { normalizeCompanyWebsiteUrl } from '@/lib/company-profile'
import { syncMonitoredAccountsFromWorkspaceSources } from '@/lib/monitored-accounts'
import { checkRateLimit } from '@/lib/rate-limit'
import { grantStarterLeadCredits } from '@/lib/lead-credits'
import { buildIcpKeywords } from '@/lib/icp'

const MAX_PROFILE_FIELD_LENGTH = 3000

export async function POST(request: Request) {
  const supabase = await createClient()
  const service = await createServiceClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    company_name, industry, target_industries, services_description,
    website_url, calendly_url, target_signal_types, min_relevance_score, icp_keywords, engines,
  } = body as Record<string, unknown>

  const selectedEngines = (Array.isArray(engines)
    ? engines.filter((e): e is 'outbound' | 'content' => e === 'outbound' || e === 'content')
    : []) as Array<'outbound' | 'content'>
  const engineList: Array<'outbound' | 'content'> = selectedEngines.length > 0 ? Array.from(new Set(selectedEngines)) : ['outbound']

  const companyName = typeof company_name === 'string' ? company_name.trim() : ''
  const industryName = typeof industry === 'string' ? industry.trim() : ''
  const targetIndustries = Array.isArray(target_industries)
    ? target_industries.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  if (!companyName || !industryName || targetIndustries.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (
    companyName.length > 200 ||
    industryName.length > 200 ||
    targetIndustries.join(',').length > 1000 ||
    (typeof services_description === 'string' && services_description.length > MAX_PROFILE_FIELD_LENGTH) ||
    (typeof website_url === 'string' && website_url.length > 500)
  ) {
    return NextResponse.json({ error: 'Profile fields exceed maximum length.' }, { status: 400 })
  }

  const rl = await checkRateLimit(`profile:${user.id}`, 10, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many profile updates. Limit is 10 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const servicesDescription = typeof services_description === 'string' ? services_description.trim() : ''
  const websiteUrl = normalizeCompanyWebsiteUrl(website_url)

  if (servicesDescription.length < 10) {
    return NextResponse.json(
      { error: 'Add a short product/service description before saving. Website suggestions must be reviewed first.' },
      { status: 400 }
    )
  }

  const explicitIcpKeywords = buildIcpKeywords({ explicitKeywords: icp_keywords })

  // ICP keywords and embeddings are both optional — don't let model/API failures block onboarding.
  const [generatedIcpKeywords, embedding] = await Promise.all([
    explicitIcpKeywords.length > 0
      ? Promise.resolve([] as string[])
      : extractICPKeywords(servicesDescription).catch(() => [] as string[]),
    embed(`${companyName} ${servicesDescription} targets: ${targetIndustries.join(', ')}`).catch(() => null as number[] | null),
  ])
  const normalizedIcpKeywords = buildIcpKeywords({
    explicitKeywords: explicitIcpKeywords,
    generatedKeywords: generatedIcpKeywords,
    targetIndustries,
  })

  const { data: existingProfile } = await supabase
    .from('user_profiles')
    .select('active_client_id, plan, leads_used_this_month, leads_reset_at, slack_webhook_url, slack_min_score, auto_send_enabled, automation_mode, subscription_status, subscription_period, subscription_renews_at, lead_credit_balance')
    .eq('user_id', user.id)
    .maybeSingle()

  let activeClientId = (existingProfile as { active_client_id?: string | null } | null)?.active_client_id ?? null
  let shouldUpdateUserProfile = true

  if (activeClientId) {
    const { data: activeClient } = await service
      .from('client_accounts')
      .select('id, user_id')
      .eq('id', activeClientId)
      .maybeSingle()

    if (!activeClient) {
      return NextResponse.json({ error: 'Active workspace not found' }, { status: 404 })
    }

    const ownsWorkspace = activeClient.user_id === user.id
    if (!ownsWorkspace) {
      const { data: membership } = await service
        .from('workspace_members')
        .select('role')
        .eq('client_id', activeClientId)
        .eq('user_id', user.id)
        .not('accepted_at', 'is', null)
        .maybeSingle()
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return NextResponse.json({ error: 'Only workspace owners and admins can edit this ICP.' }, { status: 403 })
      }
      shouldUpdateUserProfile = false
    }

    const { error: clientUpdateError } = await service
      .from('client_accounts')
      .update({
        name: companyName,
        industry: industryName,
        target_industries: targetIndustries,
        services_description: servicesDescription,
        website_url: websiteUrl,
        calendly_url: typeof calendly_url === 'string' && calendly_url.trim() ? calendly_url.trim() : null,
        target_signal_types: target_signal_types || ['funding', 'acquisition', 'expansion', 'regulation', 'hiring'],
        min_relevance_score: typeof min_relevance_score === 'number' ? min_relevance_score : 6,
        icp_keywords: normalizedIcpKeywords,
        profile_embedding: embedding ? toVectorLiteral(embedding) : null,
      })
      .eq('id', activeClientId)
    if (clientUpdateError) {
      return NextResponse.json({ error: 'Failed to save workspace profile' }, { status: 500 })
    }
  } else {
    const { data: client, error: clientErr } = await supabase
      .from('client_accounts')
      .insert({
        user_id: user.id,
        name: companyName,
        industry: industryName,
        target_industries: targetIndustries,
        services_description: servicesDescription,
        website_url: websiteUrl,
        calendly_url: typeof calendly_url === 'string' && calendly_url.trim() ? calendly_url.trim() : null,
        target_signal_types: target_signal_types || ['funding', 'acquisition', 'expansion', 'regulation', 'hiring'],
        min_relevance_score: typeof min_relevance_score === 'number' ? min_relevance_score : 6,
        icp_keywords: normalizedIcpKeywords,
        profile_embedding: embedding ? toVectorLiteral(embedding) : null,
      })
      .select('id')
      .single()

    if (clientErr || !client) {
      return NextResponse.json({ error: 'Failed to save client profile' }, { status: 500 })
    }
    activeClientId = client.id
  }

  const profilePayload = {
    user_id: user.id,
    company_name: companyName,
    industry: industryName,
    target_industries: targetIndustries,
    services_description: servicesDescription,
    website_url: websiteUrl,
    calendly_url: typeof calendly_url === 'string' && calendly_url.trim() ? calendly_url.trim() : null,
    target_signal_types: target_signal_types || ['funding', 'acquisition', 'expansion', 'regulation', 'hiring'],
    min_relevance_score: typeof min_relevance_score === 'number' ? min_relevance_score : 6,
    icp_keywords: normalizedIcpKeywords,
    profile_embedding: embedding ? toVectorLiteral(embedding) : null,
    active_client_id: activeClientId,
    plan: (existingProfile as { plan?: string | null } | null)?.plan ?? 'free',
    leads_used_this_month: (existingProfile as { leads_used_this_month?: number } | null)?.leads_used_this_month ?? 0,
    leads_reset_at: (existingProfile as { leads_reset_at?: string } | null)?.leads_reset_at ?? new Date().toISOString(),
    subscription_status: (existingProfile as { subscription_status?: string | null } | null)?.subscription_status ?? 'none',
    subscription_period: (existingProfile as { subscription_period?: string | null } | null)?.subscription_period ?? null,
    subscription_renews_at: (existingProfile as { subscription_renews_at?: string | null } | null)?.subscription_renews_at ?? null,
    lead_credit_balance: (existingProfile as { lead_credit_balance?: number | null } | null)?.lead_credit_balance ?? 0,
    slack_webhook_url: (existingProfile as { slack_webhook_url?: string | null } | null)?.slack_webhook_url ?? null,
    slack_min_score: (existingProfile as { slack_min_score?: number | null } | null)?.slack_min_score ?? 7,
    auto_send_enabled: (existingProfile as { auto_send_enabled?: boolean } | null)?.auto_send_enabled ?? false,
    automation_mode: (existingProfile as { automation_mode?: string | null } | null)?.automation_mode ?? 'approve_first',
    updated_at: new Date().toISOString(),
  }

  const { error } = shouldUpdateUserProfile
    ? await supabase.from('user_profiles').upsert(profilePayload, { onConflict: 'user_id' })
    : { error: null }

  if (error) {
    console.error('Profile save error:', error)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }

  if (!existingProfile) {
    try {
      await grantStarterLeadCredits(service, user.id)
    } catch (creditError) {
      console.error('[profile] starter credit grant failed:', creditError)
    }

    const { error: policyError } = await supabase.from('auto_send_policies').insert({
      user_id: user.id,
      client_id: activeClientId,
      enabled: false,
      connected_account_id: null,
      target_origins: ['live'],
      target_explore_session_ids: [],
      require_verified_contact: true,
      min_relevance_score: 7,
      max_lead_age_days: 30,
      daily_send_limit: 10,
      min_minutes_between_sends: 30,
      last_started_at: null,
      started_notification_sent_at: null,
      completed_notification_sent_at: null,
    })
    if (policyError) console.error('[profile] default live autopilot policy failed:', policyError)

    try {
      const { seedWorkspaceAgents } = await import('@/lib/agents/core/workspace-agents')
      await seedWorkspaceAgents(supabase, {
        workspaceId: activeClientId ?? user.id,
        userId: user.id,
        engines: engineList,
      })
    } catch (seedError) {
      console.error('[profile] workspace agent seed failed:', seedError)
    }
  }

  syncMonitoredAccountsFromWorkspaceSources(service).catch(syncError => {
    console.error('[profile] monitored account sync failed:', syncError)
  })

  return NextResponse.json({ ok: true })
}
