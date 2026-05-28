import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { requirePlan } from '@/lib/api-plan-guard'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import {
  buildCampaignBriefFromPrompt,
  campaignDiscoveryCompanyKey,
  chooseCampaignDiscoveryMode,
} from '@/lib/gtm/campaign-discovery'
import {
  createCampaignWebsetWithExa,
  discoverCampaignCandidatesWithExa,
  syncCampaignWebsetWithExa,
} from '@/lib/exa'
import {
  createCampaignExploreRun,
  materializeCampaignCandidates,
  updateCampaignExploreRun,
} from '@/lib/gtm/campaign-target-materialization'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const CAMPAIGN_SELECT = 'id, name, objective, segment, trigger, narrative, offer, success_metric, channels, status, starts_at, ends_at, learnings, created_at, updated_at'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now()
  const supabase = await createClient()
  const admin = createAdminClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck
  const rate = await checkRateLimit(`campaign:discover:${userId}`, 60, 60 * 60, { failClosed: true })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many campaign discovery requests. Try again later.' }, { status: 429 })

  const { id } = await params
  const body = await request.json().catch(() => null) as { target_count?: number } | null
  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const { data: campaign, error: campaignError } = await supabase
    .from('gtm_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('id', id)
    .eq('user_id', userId)
    .match(clientFilter)
    .single()
  if (campaignError || !campaign) return NextResponse.json({ error: campaignError?.message ?? 'Campaign not found' }, { status: 404 })

  const learnings = asRecord(campaign.learnings) ?? {}
  const requestedCount = boundedNumber(body?.target_count ?? learnings.requested_count, 1, 100, 10)
  const storedMode = learnings.discovery_mode === 'webset' ? 'webset' : learnings.discovery_mode === 'search' ? 'search' : null
  const discoveryMode = storedMode === 'webset' || chooseCampaignDiscoveryMode(requestedCount) === 'webset' ? 'webset' : 'search'
  const prompt = campaignPrompt(campaign, learnings)
  const brief = buildCampaignBriefFromPrompt(prompt)

  const { data: existingTargets } = await supabase
    .from('gtm_campaign_targets')
    .select('id, lead:leads(target_company, company_domain)')
    .eq('campaign_id', id)
    .eq('user_id', userId)
    .match(clientFilter)
  const existingKeys = new Set<string>()
  for (const target of existingTargets ?? []) {
    const lead = Array.isArray(target.lead) ? target.lead[0] : target.lead
    if (!lead || typeof lead !== 'object') continue
    const row = lead as { target_company?: unknown; company_domain?: unknown }
    existingKeys.add(campaignDiscoveryCompanyKey(
      typeof row.target_company === 'string' ? row.target_company : '',
      typeof row.company_domain === 'string' ? row.company_domain : null,
    ))
  }
  const existingCount = existingKeys.size
  const remainingCount = Math.max(0, requestedCount - existingCount)
  const now = new Date().toISOString()

  if (remainingCount === 0) {
    await supabase
      .from('gtm_campaigns')
      .update({
        learnings: {
          ...learnings,
          discovery_mode: discoveryMode,
          requested_count: requestedCount,
          discovery_status: 'ready',
          discovered_count: existingCount,
          last_discovered_at: now,
        },
      })
      .eq('id', id)
      .eq('user_id', userId)
    return NextResponse.json({
      ok: true,
      discovery: {
        provider: 'exa',
        mode: discoveryMode,
        status: 'ready',
        generated: 0,
        inserted: 0,
        skipped: 0,
        existing: existingCount,
        requested: requestedCount,
        duration_ms: Date.now() - startedAt,
      },
      leads: [],
      targets: [],
    })
  }

  const websetId = stringValue(learnings.exa_webset_id)
  const websetSearchId = stringValue(learnings.exa_webset_search_id)
  const discovery = discoveryMode === 'webset'
    ? websetId
      ? await syncCampaignWebsetWithExa({
        brief,
        count: requestedCount,
        websetId,
        websetSearchId,
        excludeKeys: existingKeys,
      })
      : await createCampaignWebsetWithExa({ brief, count: requestedCount, campaignId: id })
    : await discoverCampaignCandidatesWithExa({
      brief,
      count: Math.min(remainingCount, 24),
      excludeKeys: existingKeys,
    })

  let runId = stringValue(learnings.discovery_run_id)
  if (!runId) {
    runId = await createCampaignExploreRun({
      admin,
      userId,
      clientId: activeClientId,
      campaignId: id,
      prompt,
      segment: brief.segment,
      status: discoveryMode === 'webset' && discovery.status === 'running'
        ? 'running'
        : discovery.status === 'provider_error'
          ? 'failed'
          : 'completed',
      generatedCount: discovery.candidates.length,
      errorMessage: discovery.error ?? null,
      completedAt: discoveryMode === 'webset' && discovery.status === 'running' ? null : now,
    }) ?? ''
  }

  const materialized = await materializeCampaignCandidates({
    admin,
    supabase,
    userId,
    clientId: activeClientId,
    campaignId: id,
    runId: runId || null,
    prompt,
    candidates: discovery.candidates,
    providerRequestId: discovery.requestId ?? discovery.websetSearchId ?? websetSearchId ?? null,
    now,
  })

  await updateCampaignExploreRun({
    admin,
    runId: runId || null,
    status: discoveryMode === 'webset' && discovery.status === 'running'
      ? 'running'
      : discovery.status === 'provider_error'
        ? 'failed'
        : 'completed',
    generatedCount: discovery.candidates.length,
    insertedCount: materialized.inserted,
    skippedCount: materialized.skipped,
    errorMessage: discovery.error ?? null,
    completedAt: discoveryMode === 'webset' && discovery.status === 'running' ? null : now,
  })

  const previousInserted = numeric(learnings.inserted_count)
  const previousSkipped = numeric(learnings.skipped_count)
  const nextDiscoveredCount = existingCount + materialized.targets.length
  await supabase
    .from('gtm_campaigns')
    .update({
      learnings: {
        ...learnings,
        prompt,
        discovery_provider: 'exa',
        discovery_mode: discoveryMode,
        requested_count: requestedCount,
        discovery_queries: brief.queries,
        discovery_status: discovery.status,
        discovery_error: discovery.error ?? null,
        discovery_run_id: runId || null,
        discovery_request_id: discovery.requestId ?? null,
        discovery_request_ids: discovery.requestIds ?? [],
        exa_webset_id: discovery.websetId ?? websetId ?? null,
        exa_webset_search_id: discovery.websetSearchId ?? websetSearchId ?? null,
        exa_webset_status: discovery.websetStatus ?? null,
        exa_webset_progress: discovery.progress ?? null,
        discovered_count: nextDiscoveredCount,
        inserted_count: previousInserted + materialized.inserted,
        skipped_count: previousSkipped + materialized.skipped,
        credit_blocked: materialized.creditBlocked,
        last_discovered_at: now,
      },
    })
    .eq('id', id)
    .eq('user_id', userId)

  return NextResponse.json({
    ok: true,
    discovery: {
      provider: discovery.provider,
      mode: discoveryMode,
      status: discovery.status,
      request_id: discovery.requestId ?? null,
      request_ids: discovery.requestIds ?? [],
      webset_id: discovery.websetId ?? websetId ?? null,
      webset_search_id: discovery.websetSearchId ?? websetSearchId ?? null,
      progress: discovery.progress ?? null,
      error: discovery.error ?? null,
      requested: requestedCount,
      existing: existingCount,
      generated: discovery.candidates.length,
      inserted: materialized.inserted,
      skipped: materialized.skipped,
      credits_used: materialized.creditsUsed,
      credit_blocked: materialized.creditBlocked,
      duration_ms: Date.now() - startedAt,
    },
    leads: materialized.leads,
    targets: materialized.targets,
  })
}

function campaignPrompt(campaign: { name?: string | null; segment?: string | null; trigger?: string | null; narrative?: string | null; offer?: string | null }, learnings: Record<string, unknown>): string {
  const learned = stringValue(learnings.prompt)
  if (learned) return learned
  return [
    campaign.name,
    campaign.segment,
    campaign.trigger,
    campaign.narrative,
    campaign.offer,
  ].filter(Boolean).join(' ')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numeric(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}
