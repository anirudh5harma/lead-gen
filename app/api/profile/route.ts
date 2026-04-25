import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { embed, toVectorLiteral } from '@/lib/embeddings'
import { extractICPKeywords } from '@/lib/deepseek'
import { resolveServicesDescription } from '@/lib/company-profile'
import { syncMonitoredAccountsFromWorkspaceSources } from '@/lib/monitored-accounts'

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
    website_url, calendly_url, target_signal_types, min_relevance_score,
  } = body as Record<string, unknown>

  const companyName = typeof company_name === 'string' ? company_name.trim() : ''
  const industryName = typeof industry === 'string' ? industry.trim() : ''
  const targetIndustries = Array.isArray(target_industries)
    ? target_industries.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  if (!companyName || !industryName || targetIndustries.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const resolvedDescription = await resolveServicesDescription({
    companyName,
    industry: industryName,
    manualDescription: services_description,
    websiteUrl: website_url,
  })

  if (!resolvedDescription) {
    return NextResponse.json(
      { error: 'Add a website URL or a short product/service description so we can build your signal profile.' },
      { status: 400 }
    )
  }

  const servicesDescription = resolvedDescription.description
  const websiteUrl = resolvedDescription.websiteUrl

  // ICP keywords and embeddings are both optional — don't let model/API failures block onboarding.
  const [icp_keywords, embedding] = await Promise.all([
    extractICPKeywords(servicesDescription).catch(() => [] as string[]),
    embed(`${companyName} ${servicesDescription} targets: ${targetIndustries.join(', ')}`).catch(() => null as number[] | null),
  ])

  const { data: existingProfile } = await supabase
    .from('user_profiles')
    .select('active_client_id, plan, leads_used_this_month, leads_reset_at, slack_webhook_url, auto_send_enabled, allow_lead_overage')
    .eq('user_id', user.id)
    .maybeSingle()

  let activeClientId = (existingProfile as { active_client_id?: string | null } | null)?.active_client_id ?? null

  if (activeClientId) {
    await supabase
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
        icp_keywords,
        profile_embedding: embedding ? toVectorLiteral(embedding) : null,
      })
      .eq('id', activeClientId)
      .eq('user_id', user.id)
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
        icp_keywords,
        profile_embedding: embedding ? toVectorLiteral(embedding) : null,
      })
      .select('id')
      .single()

    if (clientErr || !client) {
      return NextResponse.json({ error: 'Failed to save client profile' }, { status: 500 })
    }
    activeClientId = client.id
  }

  const { error } = await supabase.from('user_profiles').upsert({
    user_id: user.id,
    company_name: companyName,
    industry: industryName,
    target_industries: targetIndustries,
    services_description: servicesDescription,
    website_url: websiteUrl,
    calendly_url: typeof calendly_url === 'string' && calendly_url.trim() ? calendly_url.trim() : null,
    target_signal_types: target_signal_types || ['funding', 'acquisition', 'expansion', 'regulation', 'hiring'],
    min_relevance_score: typeof min_relevance_score === 'number' ? min_relevance_score : 6,
    icp_keywords,
    profile_embedding: embedding ? toVectorLiteral(embedding) : null,
    active_client_id: activeClientId,
    plan: (existingProfile as { plan?: string } | null)?.plan ?? 'free',
    leads_used_this_month: (existingProfile as { leads_used_this_month?: number } | null)?.leads_used_this_month ?? 0,
    leads_reset_at: (existingProfile as { leads_reset_at?: string } | null)?.leads_reset_at ?? new Date().toISOString(),
    slack_webhook_url: (existingProfile as { slack_webhook_url?: string | null } | null)?.slack_webhook_url ?? null,
    auto_send_enabled: (existingProfile as { auto_send_enabled?: boolean } | null)?.auto_send_enabled ?? false,
    allow_lead_overage: (existingProfile as { allow_lead_overage?: boolean } | null)?.allow_lead_overage ?? false,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  if (error) {
    console.error('Profile save error:', error)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }

  syncMonitoredAccountsFromWorkspaceSources(service).catch(syncError => {
    console.error('[profile] monitored account sync failed:', syncError)
  })

  return NextResponse.json({ ok: true })
}
