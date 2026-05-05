import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { generateExploreLeads, type ExploreLeadSuggestion } from '@/lib/deepseek'
import { shouldUseWorkspaceIcp } from '@/lib/explore'
import { buildFeedSessionLabel } from '@/lib/feed-sessions'
import { buildExploreLeadFeedSnapshot, type LeadSignalType } from '@/lib/lead-sources'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_RESULTS = 12
const MAX_RESULTS = 100
const MAX_GENERATION_BATCH_SIZE = 25
const MAX_PROMPT_LENGTH = 1500
const MAX_ICP_HINT_LENGTH = 300

const EXPLORE_LIMITS = {
  maxResults: 50,
  perHour: 10,
  perDay: 50,
} as const

export async function POST(request: Request) {
  const startedAt = Date.now()
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    prompt?: string
    icp_hint?: string
    count?: number
    filters?: {
      industry?: string
      region?: string
      revenue?: string
      employee_count?: string
    }
  } | null

  const prompt = buildStructuredExplorePrompt(body)
  const filterHint = buildFilterIcpHint(body?.filters)
  const icpHint = [body?.icp_hint?.trim() ?? '', filterHint]
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_ICP_HINT_LENGTH)
  if (prompt.length < 8) {
    return NextResponse.json({ error: 'Add a more specific targeting prompt.' }, { status: 400 })
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: `Prompt is too long. Keep prompted discovery under ${MAX_PROMPT_LENGTH} characters.` }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const [{ data: profile }, { data: clientProfile }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('services_description, icp_keywords')
      .eq('user_id', user.id)
      .single(),
    activeClientId
      ? supabase
          .from('client_accounts')
          .select('services_description, icp_keywords')
          .eq('id', activeClientId)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const hourlyLimit = await checkRateLimit(`explore:${user.id}:hour`, EXPLORE_LIMITS.perHour, 3600, { failClosed: true })
  if (!hourlyLimit.allowed) {
    return NextResponse.json(
      { error: `Too many prompted discovery runs. Limit is ${EXPLORE_LIMITS.perHour} per hour.` },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }
  const dailyLimit = await checkRateLimit(`explore:${user.id}:day`, EXPLORE_LIMITS.perDay, 86_400, { failClosed: true })
  if (!dailyLimit.allowed) {
    return NextResponse.json(
      { error: `Daily prompted discovery limit reached. Limit is ${EXPLORE_LIMITS.perDay} runs per day.` },
      { status: 429, headers: { 'Retry-After': '86400' } },
    )
  }

  const servicesDescription = clientProfile?.services_description || profile?.services_description || ''
  const icpKeywords = (clientProfile?.icp_keywords ?? profile?.icp_keywords ?? []) as string[]
  const useWorkspaceIcp = shouldUseWorkspaceIcp({ prompt, icpHint })
  const workspaceIcpContext = useWorkspaceIcp
    ? [
        icpHint ? `User ICP hint: ${icpHint}` : '',
        icpKeywords.length > 0 ? `Workspace ICP keywords: ${icpKeywords.join(', ')}` : '',
      ].filter(Boolean).join('\n')
    : ''

  const { data: run } = await admin
    .from('explore_runs')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      prompt,
      icp_hint: icpHint || null,
      seller_profile_snapshot: servicesDescription || null,
      workspace_icp_snapshot: workspaceIcpContext || null,
      used_workspace_icp: useWorkspaceIcp,
      status: 'running',
    })
    .select('id')
    .single()

  const runId = run?.id ?? null

  const requestedCount = extractRequestedLeadCount(prompt) ?? DEFAULT_RESULTS
  const targetCount = Math.max(1, Math.min(MAX_RESULTS, EXPLORE_LIMITS.maxResults, requestedCount))
  const generatedLeads: ExploreLeadSuggestion[] = []
  let generationFailure: Awaited<ReturnType<typeof generateExploreLeads>> | null = null
  const excludedCompanies = new Set<string>()

  while (generatedLeads.length < targetCount) {
    const remaining = targetCount - generatedLeads.length
    const generation = await generateExploreLeads({
      prompt,
      sellerProfileDescription: servicesDescription,
      workspaceIcpContext,
      useWorkspaceIcp,
      count: Math.min(MAX_GENERATION_BATCH_SIZE, remaining),
      excludeCompanies: [...excludedCompanies],
    })

    if (!generation.ok) {
      generationFailure = generation
      break
    }

    let addedThisBatch = 0
    for (const lead of generation.leads) {
      const key = normalizeExploreCompanyKey(lead.company_name, lead.company_domain)
      if (excludedCompanies.has(key)) continue
      excludedCompanies.add(key)
      generatedLeads.push(lead)
      addedThisBatch++
      if (generatedLeads.length >= targetCount) break
    }

    if (addedThisBatch === 0 || generation.leads.length === 0) break
  }

  if (generatedLeads.length === 0 && generationFailure) {
    if (runId) {
      await admin
        .from('explore_runs')
        .update({
          status: 'failed',
          error_message: generationFailure.rejection_reason ?? 'Prompt generation failed.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
    }

    return NextResponse.json({
      ok: false,
      inserted: 0,
      skipped: 0,
      generated: 0,
      duration_ms: Date.now() - startedAt,
      requested: targetCount,
      message: generationFailure.rejection_reason ?? 'This prompt is outside the scope of lead generation.',
    }, { status: generationFailure.failure_kind === 'invalid_prompt' ? 400 : 502 })
  }

  const suggestions = generatedLeads.slice(0, targetCount)

  if (suggestions.length === 0) {
    if (runId) {
      await admin
        .from('explore_runs')
        .update({
          status: 'completed',
          generated_count: 0,
          inserted_count: 0,
          skipped_count: 0,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
    }

    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped: 0,
      generated: 0,
      requested: targetCount,
      duration_ms: Date.now() - startedAt,
      message: 'No lead suggestions were generated for this prompt.',
    })
  }

  const now = new Date().toISOString()
  const sessionLabel = buildFeedSessionLabel({
    origin: 'explore',
    startedAt: now,
    prompt,
  })
  const leadSelect = 'id, client_id, origin, source_kind, source_record_id, feed_session_id, feed_session_label, feed_session_started_at, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, unlocked_at, created_at, sent_at, replied_at, booked_at, reply_intent, reply_summary, reply_body_snippet, reply_received_at, meeting_detected_at, booking_reply_sent_at, contact_email, contact_name, contact_title, feed_snapshot'
  const leads: unknown[] = []
  let inserted = 0
  let skipped = 0
  let duplicates = 0
  let sourceErrors = 0
  let leadErrors = 0

  for (const suggestion of suggestions) {
    const resultKey = buildExploreResultKey({
      userId: user.id,
      clientId: activeClientId,
      companyName: suggestion.company_name,
      companyDomain: suggestion.company_domain,
    })

    const { data: target, error: targetError } = await saveExploreTarget(admin, {
      run_id: runId,
      user_id: user.id,
      client_id: activeClientId,
      result_key: resultKey,
      company_name: suggestion.company_name,
      company_domain: suggestion.company_domain,
      signal_type: suggestion.signal_type,
      headline: suggestion.headline,
      summary: suggestion.summary,
      relevance_reason: suggestion.relevance_reason,
      relevance_score: suggestion.relevance_score,
      prompt,
      icp_hint: icpHint || null,
      source_payload: {
        prompt,
        icp_hint: icpHint || null,
        used_workspace_icp: useWorkspaceIcp,
      },
      updated_at: now,
    })

    if (targetError || !target) {
      sourceErrors++
      if (targetError) console.error('[explore] explore target save error:', targetError.message)
      skipped++
      continue
    }

    const { data: existingLead } = await admin
      .from('leads')
      .select(leadSelect)
      .eq('user_id', user.id)
      .eq('source_kind', 'explore_target')
      .eq('source_record_id', target.id)
      .maybeSingle()

    if (existingLead) {
      duplicates++
      skipped++
      leads.push(existingLead)
      continue
    }

    const snapshot = buildExploreLeadFeedSnapshot({
      signalType: suggestion.signal_type as LeadSignalType,
      headline: suggestion.headline,
      summary: suggestion.summary,
      companyDomain: suggestion.company_domain,
      prompt,
      icpHint: icpHint || null,
      usedWorkspaceIcp: useWorkspaceIcp,
      sourceUrl: `explore://target/${target.id}`,
      sourceName: 'explore_generated',
      publishedAt: now,
    })

    const { data: lead, error: leadError } = await admin
      .from('leads')
      .insert({
        user_id: user.id,
        client_id: activeClientId,
        signal_id: null,
        origin: 'explore',
        feed_session_id: runId,
        feed_session_label: sessionLabel,
        feed_session_started_at: now,
        source_kind: 'explore_target',
        source_record_id: target.id,
        target_company: suggestion.company_name,
        company_domain: suggestion.company_domain,
        relevance_score: suggestion.relevance_score,
        relevance_reason: `Batch source: ${suggestion.relevance_reason}`.slice(0, 1000),
        status: 'new',
        is_unlocked: false,
        unlocked_at: null,
        feed_snapshot: snapshot,
        match_debug: {
          matched_via: 'explore_generation',
          prompt,
          icp_hint: icpHint || null,
          used_workspace_icp: useWorkspaceIcp,
          run_id: runId,
          source_kind: 'explore_target',
        },
      })
      .select(leadSelect)
      .single()

    if (leadError) {
      leadErrors++
      console.error('[explore] lead insert error:', leadError.message)
      skipped++
      continue
    }

    if (lead) leads.push(lead)
    inserted++
  }

  if (runId) {
    await admin
      .from('explore_runs')
      .update({
        status: 'completed',
      generated_count: suggestions.length,
        inserted_count: inserted,
        skipped_count: skipped,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
  }

  return NextResponse.json({
    ok: true,
    generated: suggestions.length,
    requested: targetCount,
    inserted,
    skipped,
    duplicates,
    source_errors: sourceErrors,
    lead_errors: leadErrors,
    leads,
    duration_ms: Date.now() - startedAt,
    message: inserted > 0
      ? `Added ${inserted} of ${targetCount} requested explore ${inserted === 1 ? 'lead' : 'leads'}${useWorkspaceIcp ? ' using workspace ICP context.' : ' directly from the prompt.'}`
      : duplicates > 0 && sourceErrors === 0 && leadErrors === 0
          ? `Found ${duplicates} duplicate explore ${duplicates === 1 ? 'lead' : 'leads'} and added no new ones.`
          : 'No new explore leads were added due to save errors.',
  })
}

function buildStructuredExplorePrompt(body: {
  prompt?: string
  count?: number
  filters?: {
    industry?: string
    region?: string
    revenue?: string
    employee_count?: string
  }
} | null): string {
  const basePrompt = body?.prompt?.trim() ?? ''
  const filters = body?.filters ?? {}
  const count = Number.isFinite(body?.count) ? Math.round(Number(body?.count)) : DEFAULT_RESULTS
  const normalizedCount = Math.max(1, Math.min(MAX_RESULTS, EXPLORE_LIMITS.maxResults, count))
  const filterLines = [
    filters.industry ? `Industry: ${filters.industry}` : '',
    filters.region ? `Region: ${filters.region}` : '',
    filters.revenue ? `Revenue: ${filters.revenue}` : '',
    filters.employee_count ? `Employee count: ${filters.employee_count}` : '',
  ].filter(Boolean)

  if (filterLines.length === 0) return basePrompt

  return [
    `Find ${normalizedCount} B2B companies that match our ICP and these lead generation filters.`,
    ...filterLines,
    basePrompt ? `Additional targeting notes: ${basePrompt}` : '',
    'Prioritize accounts with a likely current GTM pain, buying trigger, or operational urgency.',
  ].filter(Boolean).join('\n')
}

function buildFilterIcpHint(filters?: {
  industry?: string
  region?: string
  revenue?: string
  employee_count?: string
}): string {
  if (!filters) return ''
  return [
    filters.industry ? `Target industry: ${filters.industry}` : '',
    filters.region ? `Target region: ${filters.region}` : '',
    filters.revenue ? `Target revenue: ${filters.revenue}` : '',
    filters.employee_count ? `Target employee count: ${filters.employee_count}` : '',
  ].filter(Boolean).join('\n')
}

function extractRequestedLeadCount(prompt: string): number | null {
  const explicit = prompt.match(/\b(\d{1,3})\s*(?:leads?|companies|accounts|prospects|targets)\b/i)
  const fallback = prompt.match(/\b(?:find|give|generate|return|show|source|get)\s+(\d{1,3})\b/i)
  const raw = explicit?.[1] ?? fallback?.[1]
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value)
}

function normalizeExploreCompanyKey(companyName: string, companyDomain: string | null): string {
  return (companyDomain || companyName)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.-]+/g, '-')
}

function buildExploreResultKey(params: {
  userId: string
  clientId: string | null
  companyName: string
  companyDomain: string | null
}) {
  return [
    'explore',
    params.userId,
    params.clientId ?? 'workspace-none',
    (params.companyDomain || params.companyName).trim().toLowerCase(),
  ]
    .join(':')
    .replace(/[^a-z0-9:.-]+/g, '-')
}

async function saveExploreTarget(
  admin: ReturnType<typeof createAdminClient>,
  payload: {
    run_id: string | null
    user_id: string
    client_id: string | null
    result_key: string
    company_name: string
    company_domain: string | null
    signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
    headline: string
    summary: string
    relevance_reason: string
    relevance_score: number
    prompt: string
    icp_hint: string | null
    source_payload: Record<string, unknown>
    updated_at: string
  },
) {
  const { data: existing, error: existingError } = await admin
    .from('explore_targets')
    .select('id')
    .eq('result_key', payload.result_key)
    .maybeSingle()

  if (existingError) return { data: null, error: existingError }

  if (existing) {
    const { data, error } = await admin
      .from('explore_targets')
      .update(payload)
      .eq('id', existing.id)
      .select('id')
      .single()
    return { data, error }
  }

  const inserted = await admin
    .from('explore_targets')
    .insert(payload)
    .select('id')
    .single()

  if (!inserted.error) return inserted

  if (inserted.error.code === '23505') {
    return await admin
      .from('explore_targets')
      .select('id')
      .eq('result_key', payload.result_key)
      .single()
  }

  return inserted
}
