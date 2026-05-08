import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import type { ExploreLeadSuggestion } from '@/lib/deepseek'
import { buildFeedSessionLabel } from '@/lib/feed-sessions'
import { buildExploreLeadFeedSnapshot, type LeadSignalType } from '@/lib/lead-sources'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  apolloCompanyMatchesFilters as providerCompanyMatchesFilters,
  apolloOrganizationSearch as providerOrganizationSearch,
} from '@/lib/apollo'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_RESULTS = 10
const MAX_RESULTS = 100
const PROVIDER_EXPLORE_MAX_RESULTS = 40
const PROVIDER_EXPLORE_MAX_PAGES = 4
const EXPLORE_RESULT_OPTIONS = [5, 10, 20] as const
const ALLOWED_INDUSTRIES = new Set([
  'SaaS and software',
  'AI and data infrastructure',
  'Fintech',
  'Healthcare technology',
  'Ecommerce and retail tech',
  'Cybersecurity',
  'Logistics and supply chain',
  'Manufacturing',
  'Professional services',
])
const ALLOWED_REGIONS = new Set([
  'United States',
  'North America',
  'United Kingdom',
  'Europe',
  'India',
  'Asia Pacific',
  'Middle East',
  'Global English-speaking markets',
])
const ALLOWED_REVENUE = new Set([
  'Under $1M',
  '$1M-$10M',
  '$10M-$50M',
  '$50M-$250M',
  '$250M+',
])
const ALLOWED_EMPLOYEE_COUNTS = new Set([
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001-5000',
  '5000+',
])
const ALLOWED_MARKET_SEGMENTS = new Set(['SMB', 'Mid-Market', 'Enterprise'])
const ALLOWED_FUNDING = new Set([
  'Funded in last 90 days',
  'Funded in last 180 days',
  'Latest round $1M-$10M',
  'Latest round $10M-$50M',
  'Latest round $50M+',
])
const ALLOWED_SIGNALS = new Set([
  'Actively hiring',
  'High hiring volume',
  'Sales hiring',
  'Engineering hiring',
])

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
    count?: number
    filters?: {
      industry?: string
      region?: string
      revenue?: string
      employee_count?: string
      market_segment?: string
      funding?: string
      signal?: string
    }
  } | null

  const invalidFilters = validateExploreFilters(body?.filters)
  if (invalidFilters.length > 0) {
    return NextResponse.json({
      error: `Unsupported filter option(s): ${invalidFilters.join(', ')}`,
    }, { status: 400 })
  }

  const activeFilters = normalizeExploreFilters(body?.filters)
  const requestedCount = normalizeExploreCount(body?.count)
  if (!hasAnyFilter(activeFilters)) {
    return NextResponse.json({ error: 'Select at least one filter before running Explore search.' }, { status: 400 })
  }

  const prompt = buildStructuredExplorePrompt(body)

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const hourlyLimit = await checkRateLimit(`explore:${user.id}:hour`, EXPLORE_LIMITS.perHour, 3600, { failClosed: true })
  if (!hourlyLimit.allowed) {
    return NextResponse.json(
      { error: `Too many explore runs. Limit is ${EXPLORE_LIMITS.perHour} per hour.` },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }
  const dailyLimit = await checkRateLimit(`explore:${user.id}:day`, EXPLORE_LIMITS.perDay, 86_400, { failClosed: true })
  if (!dailyLimit.allowed) {
    return NextResponse.json(
      { error: `Daily explore run limit reached. Limit is ${EXPLORE_LIMITS.perDay} runs per day.` },
      { status: 429, headers: { 'Retry-After': '86400' } },
    )
  }

  const { data: run } = await admin
    .from('explore_runs')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      prompt,
      icp_hint: null,
      seller_profile_snapshot: null,
      workspace_icp_snapshot: null,
      used_workspace_icp: false,
      status: 'running',
    })
    .select('id')
    .single()

  const runId = run?.id ?? null

  const targetCount = Math.max(1, Math.min(MAX_RESULTS, EXPLORE_LIMITS.maxResults, requestedCount))
  const providerSuggestions = await generateProviderExploreSuggestions({
    count: Math.min(targetCount, PROVIDER_EXPLORE_MAX_RESULTS),
    filters: activeFilters,
    excludedCompanies: new Set<string>(),
  })
  const suggestions = providerSuggestions.slice(0, targetCount)

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
      message: 'No companies matched the selected filters.',
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
  let creditsUsed = 0
  let creditsRefunded = 0
  let creditErrors = 0
  let creditBlocked = 0

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
      icp_hint: null,
      source_payload: {
        prompt,
        icp_hint: null,
        used_workspace_icp: false,
        filters: activeFilters,
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

    let usedCredit = false
    try {
      usedCredit = await consumeLeadCredit(supabase, {
        userId: user.id,
        metadata: {
          source: 'explore_generation',
          run_id: runId,
          company_name: suggestion.company_name,
          company_domain: suggestion.company_domain,
        },
      })
    } catch (creditError) {
      creditErrors++
      console.error('[explore] credit consume error:', creditError instanceof Error ? creditError.message : creditError)
      skipped++
      break
    }

    if (!usedCredit) {
      creditBlocked++
      skipped++
      break
    }
    creditsUsed++

    const snapshot = buildExploreLeadFeedSnapshot({
      signalType: suggestion.signal_type as LeadSignalType,
      headline: suggestion.headline,
      summary: suggestion.summary,
      companyDomain: suggestion.company_domain,
      prompt,
      icpHint: null,
      usedWorkspaceIcp: false,
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
        is_unlocked: true,
        unlocked_at: now,
        feed_snapshot: snapshot,
        match_debug: {
          matched_via: 'explore_generation',
          prompt,
          icp_hint: null,
          used_workspace_icp: false,
          run_id: runId,
          source_kind: 'explore_target',
          credit_source: 'explore_generation',
        },
      })
      .select(leadSelect)
      .single()

    if (leadError) {
      await refundLeadCredit(supabase, {
        userId: user.id,
        metadata: {
          source: 'explore_generation_insert_failed_refund',
          run_id: runId,
          company_name: suggestion.company_name,
          company_domain: suggestion.company_domain,
        },
      }).then(() => {
        creditsRefunded++
        creditsUsed = Math.max(0, creditsUsed - 1)
      }).catch(refundError => {
        console.error('[explore] credit refund error:', refundError instanceof Error ? refundError.message : refundError)
      })
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
    credits_used: creditsUsed,
    credits_refunded: creditsRefunded,
    credit_errors: creditErrors,
    credit_blocked: creditBlocked,
    leads,
    duration_ms: Date.now() - startedAt,
    message: inserted > 0
      ? `Added ${inserted} of ${targetCount} requested explore ${inserted === 1 ? 'lead' : 'leads'}${creditBlocked > 0 ? '. No additional lead credits were available for the remaining candidates.' : '.'}`
      : creditBlocked > 0
          ? 'No new explore leads were added because no lead credits were available.'
      : duplicates > 0 && sourceErrors === 0 && leadErrors === 0
          ? `Found ${duplicates} duplicate explore ${duplicates === 1 ? 'lead' : 'leads'} and added no new ones.`
          : 'No new explore leads were added due to save errors.',
  })
}

async function generateProviderExploreSuggestions(params: {
  count: number
  filters: ExploreFilters
  excludedCompanies: Set<string>
}): Promise<ExploreLeadSuggestion[]> {
  if (process.env.APOLLO_EXPLORE_ENABLED === 'false') return []
  if (!process.env.APOLLO_API_KEY) return []

  const revenueRange = parseRevenueRangeFilter(params.filters.revenue)
  const employeeRange = normalizeEmployeeRangeFilter(params.filters.employee_count)
    ?? mapMarketSegmentToEmployeeRange(params.filters.market_segment)
  const fundingFilter = mapFundingFilter(params.filters.funding)
  const signalFilter = mapSignalFilter(params.filters.signal)
  const suggestions: ExploreLeadSuggestion[] = []
  const perPage = Math.max(10, Math.min(params.count * 3, 75))

  for (let page = 1; page <= PROVIDER_EXPLORE_MAX_PAGES; page++) {
    const orgs = await providerOrganizationSearch({
      query: '',
      page,
      perPage,
      industry: params.filters.industry ?? null,
      region: mapRegionFilterToProviderLocations(params.filters.region) ?? null,
      employeeRange,
      revenueMin: revenueRange?.min ?? null,
      revenueMax: revenueRange?.max ?? null,
      latestFundingMin: fundingFilter?.latestFundingMin ?? null,
      latestFundingMax: fundingFilter?.latestFundingMax ?? null,
      latestFundingDateMin: fundingFilter?.latestFundingDateMin ?? null,
      latestFundingDateMax: fundingFilter?.latestFundingDateMax ?? null,
      jobTitles: signalFilter?.jobTitles ?? null,
      minOpenJobs: signalFilter?.minOpenJobs ?? null,
      maxOpenJobs: signalFilter?.maxOpenJobs ?? null,
      jobPostedDateMin: signalFilter?.jobPostedDateMin ?? null,
      jobPostedDateMax: signalFilter?.jobPostedDateMax ?? null,
    })
    if (orgs.length === 0) break

    for (const org of orgs) {
      const key = normalizeExploreCompanyKey(org.name, org.domain || null)
      if (params.excludedCompanies.has(key)) continue

      const filterCheck = providerCompanyMatchesFilters(org, params.filters)
      if (!filterCheck.matches) continue

      const reasonBits = [
        org.industry ? `${org.industry} company` : 'B2B company',
        org.location ? `in ${org.location}` : null,
        org.employee_count ? `${org.employee_count} employees` : null,
      ].filter(Boolean)
      const summary = [
        `${org.name} matches the selected filters`,
        reasonBits.length > 0 ? `(${reasonBits.join(', ')}).` : '.',
      ].join(' ')
      const filterCount = countActiveFilters(params.filters)
      const score = Math.max(4, Math.min(10, 5 + filterCount))

      suggestions.push({
        company_name: org.name,
        company_domain: org.domain || null,
        signal_type: resolveExploreSignalTypeFromFilters(params.filters),
        headline: `${org.name} matches your explore filters`,
        summary,
        relevance_reason: 'Matched selected explore filters.',
        relevance_score: score,
      })
      params.excludedCompanies.add(key)
      if (suggestions.length >= params.count) return suggestions
    }
  }

  return suggestions
}

function parseRevenueRangeFilter(value: string | undefined): { min?: number; max?: number } | null {
  switch (value) {
    case 'Under $1M':
      return { max: 1_000_000 }
    case '$1M-$10M':
      return { min: 1_000_000, max: 10_000_000 }
    case '$10M-$50M':
      return { min: 10_000_000, max: 50_000_000 }
    case '$50M-$250M':
      return { min: 50_000_000, max: 250_000_000 }
    case '$250M+':
      return { min: 250_000_000 }
    default:
      return null
  }
}

function mapMarketSegmentToEmployeeRange(value: string | undefined): string | null {
  switch (value) {
    case 'SMB':
      return '1,50'
    case 'Mid-Market':
      return '51,500'
    case 'Enterprise':
      return '501,100000'
    default:
      return null
  }
}

function mapFundingFilter(value: string | undefined): {
  latestFundingMin?: number
  latestFundingMax?: number
  latestFundingDateMin?: string
  latestFundingDateMax?: string
} | null {
  if (!value) return null
  const today = new Date()
  const iso = (daysAgo: number) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - daysAgo)
    return date.toISOString().slice(0, 10)
  }

  switch (value) {
    case 'Funded in last 90 days':
      return { latestFundingDateMin: iso(90), latestFundingDateMax: iso(0) }
    case 'Funded in last 180 days':
      return { latestFundingDateMin: iso(180), latestFundingDateMax: iso(0) }
    case 'Latest round $1M-$10M':
      return { latestFundingMin: 1_000_000, latestFundingMax: 10_000_000 }
    case 'Latest round $10M-$50M':
      return { latestFundingMin: 10_000_000, latestFundingMax: 50_000_000 }
    case 'Latest round $50M+':
      return { latestFundingMin: 50_000_000 }
    default:
      return null
  }
}

function mapSignalFilter(value: string | undefined): {
  jobTitles?: string[]
  minOpenJobs?: number
  maxOpenJobs?: number
  jobPostedDateMin?: string
  jobPostedDateMax?: string
} | null {
  if (!value) return null
  const today = new Date()
  const iso = (daysAgo: number) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - daysAgo)
    return date.toISOString().slice(0, 10)
  }

  switch (value) {
    case 'Actively hiring':
      return { minOpenJobs: 5, jobPostedDateMin: iso(30), jobPostedDateMax: iso(0) }
    case 'High hiring volume':
      return { minOpenJobs: 20, jobPostedDateMin: iso(45), jobPostedDateMax: iso(0) }
    case 'Sales hiring':
      return {
        jobTitles: ['sales manager', 'account executive', 'sales development representative'],
        minOpenJobs: 3,
        jobPostedDateMin: iso(45),
        jobPostedDateMax: iso(0),
      }
    case 'Engineering hiring':
      return {
        jobTitles: ['software engineer', 'engineering manager', 'backend engineer'],
        minOpenJobs: 3,
        jobPostedDateMin: iso(45),
        jobPostedDateMax: iso(0),
      }
    default:
      return null
  }
}

function normalizeEmployeeRangeFilter(value: string | undefined): string | null {
  switch (value) {
    case '1-10':
      return '1,10'
    case '11-50':
      return '11,50'
    case '51-200':
      return '51,200'
    case '201-500':
      return '201,500'
    case '501-1000':
      return '501,1000'
    case '1001-5000':
      return '1001,5000'
    case '5000+':
      return '5000,100000'
    default:
      return null
  }
}

function resolveExploreSignalTypeFromFilters(
  filters: ExploreFilters,
): ExploreLeadSuggestion['signal_type'] {
  if (filters.funding) return 'funding'
  if (filters.signal === 'Actively hiring' || filters.signal === 'High hiring volume' || filters.signal === 'Sales hiring' || filters.signal === 'Engineering hiring') {
    return 'hiring'
  }
  return 'expansion'
}

function mapRegionFilterToProviderLocations(value: string | undefined): string[] | null {
  switch (value) {
    case 'United States':
      return ['United States']
    case 'North America':
      return ['United States', 'Canada', 'Mexico']
    case 'United Kingdom':
      return ['United Kingdom']
    case 'Europe':
      return ['United Kingdom', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Sweden', 'Ireland', 'Switzerland']
    case 'India':
      return ['India']
    case 'Asia Pacific':
      return ['India', 'Singapore', 'Australia', 'New Zealand', 'Japan', 'South Korea', 'Hong Kong']
    case 'Middle East':
      return ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Bahrain', 'Kuwait', 'Oman', 'Israel']
    case 'Global English-speaking markets':
      return ['United States', 'United Kingdom', 'Canada', 'Australia', 'New Zealand', 'Ireland', 'Singapore']
    default:
      return null
  }
}

function buildStructuredExplorePrompt(body: {
  prompt?: string
  count?: number
  filters?: ExploreFilters
} | null): string {
  const basePrompt = body?.prompt?.trim() ?? ''
  const filters = normalizeExploreFilters(body?.filters)
  const normalizedCount = normalizeExploreCount(body?.count)
  const filterLines = [
    filters.industry ? `Industry: ${filters.industry}` : '',
    filters.region ? `Region: ${filters.region}` : '',
    filters.revenue ? `Revenue: ${filters.revenue}` : '',
    filters.employee_count ? `Employee count: ${filters.employee_count}` : '',
    filters.market_segment ? `Market segment: ${filters.market_segment}` : '',
    filters.funding ? `Funding: ${filters.funding}` : '',
    filters.signal ? `Signal: ${filters.signal}` : '',
  ].filter(Boolean)

  if (filterLines.length === 0) {
    return basePrompt || `Find ${normalizedCount} B2B companies for outbound prospecting.`
  }

  return [
    `Find ${normalizedCount} B2B companies for outbound prospecting with these filters.`,
    ...filterLines,
    basePrompt ? `Additional targeting notes: ${basePrompt}` : '',
    'Prioritize accounts with a likely current GTM pain, buying trigger, or operational urgency.',
  ].filter(Boolean).join('\n')
}

type ExploreFilters = {
  industry?: string
  region?: string
  revenue?: string
  employee_count?: string
  market_segment?: string
  funding?: string
  signal?: string
}

function validateExploreFilters(filters: ExploreFilters | undefined): string[] {
  if (!filters) return []
  const invalid: string[] = []
  const validate = (label: string, value: string | undefined, allowed: Set<string>) => {
    if (!value) return
    const trimmed = value.trim()
    if (!trimmed || trimmed.startsWith('Any')) return
    if (!allowed.has(trimmed)) invalid.push(`${label}:${trimmed}`)
  }

  validate('industry', filters.industry, ALLOWED_INDUSTRIES)
  validate('region', filters.region, ALLOWED_REGIONS)
  validate('revenue', filters.revenue, ALLOWED_REVENUE)
  validate('employee_count', filters.employee_count, ALLOWED_EMPLOYEE_COUNTS)
  validate('market_segment', filters.market_segment, ALLOWED_MARKET_SEGMENTS)
  validate('funding', filters.funding, ALLOWED_FUNDING)
  validate('signal', filters.signal, ALLOWED_SIGNALS)

  return invalid
}

function normalizeExploreFilters(filters: ExploreFilters | undefined): ExploreFilters {
  if (!filters) return {}
  const normalizeValue = (value: string | undefined, allowed: Set<string>): string => {
    if (!value) return ''
    const trimmed = value.trim()
    if (trimmed.startsWith('Any')) return ''
    return allowed.has(trimmed) ? trimmed : ''
  }

  return {
    industry: normalizeValue(filters.industry, ALLOWED_INDUSTRIES),
    region: normalizeValue(filters.region, ALLOWED_REGIONS),
    revenue: normalizeValue(filters.revenue, ALLOWED_REVENUE),
    employee_count: normalizeValue(filters.employee_count, ALLOWED_EMPLOYEE_COUNTS),
    market_segment: normalizeValue(filters.market_segment, ALLOWED_MARKET_SEGMENTS),
    funding: normalizeValue(filters.funding, ALLOWED_FUNDING),
    signal: normalizeValue(filters.signal, ALLOWED_SIGNALS),
  }
}

function normalizeExploreCount(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_RESULTS
  if (EXPLORE_RESULT_OPTIONS.includes(numeric as (typeof EXPLORE_RESULT_OPTIONS)[number])) return numeric
  return DEFAULT_RESULTS
}

function hasAnyFilter(filters: ExploreFilters): boolean {
  return Boolean(
    filters.industry ||
    filters.region ||
    filters.revenue ||
    filters.employee_count ||
    filters.market_segment ||
    filters.funding ||
    filters.signal
  )
}

function countActiveFilters(filters: ExploreFilters): number {
  return [
    filters.industry,
    filters.region,
    filters.revenue,
    filters.employee_count,
    filters.market_segment,
    filters.funding,
    filters.signal,
  ].filter(Boolean).length
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
