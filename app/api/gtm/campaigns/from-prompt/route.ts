import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { requirePlan } from '@/lib/api-plan-guard'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { buildCampaignReadiness } from '@/lib/gtm/campaigns'
import {
  buildCampaignBriefFromPrompt,
  chooseCampaignDiscoveryMode,
} from '@/lib/gtm/campaign-discovery'
import {
  createCampaignWebsetWithExa,
  discoverCampaignCandidatesWithExa,
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

export async function POST(request: Request) {
  const startedAt = Date.now()
  const supabase = await createClient()
  const admin = createAdminClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck

  const rate = await checkRateLimit(`campaign:from-prompt:${userId}`, 20, 60 * 60, { failClosed: true })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many prompt campaigns. Try again later.' }, { status: 429 })

  const body = await request.json().catch(() => null) as {
    prompt?: string
    target_count?: number
    channels?: string[]
  } | null
  const prompt = body?.prompt?.trim() ?? ''
  if (prompt.length < 12) {
    return NextResponse.json({ error: 'Describe the campaign requirement in a little more detail.' }, { status: 400 })
  }

  const targetCount = boundedNumber(body?.target_count, 1, 100, 10)
  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const brief = buildCampaignBriefFromPrompt(prompt)
  const channels = sanitizeChannels(body?.channels?.length ? body.channels : brief.channels)
  const discoveryMode = chooseCampaignDiscoveryMode(targetCount)

  const { data: campaign, error: campaignError } = await supabase
    .from('gtm_campaigns')
    .insert({
      user_id: userId,
      client_id: activeClientId,
      name: brief.name,
      objective: brief.objective,
      segment: brief.segment,
      trigger: brief.trigger,
      narrative: brief.narrative,
      offer: brief.offer,
      success_metric: brief.successMetric,
      channels,
      status: 'draft',
      learnings: {
        created_from_prompt: true,
        prompt,
        discovery_provider: 'exa',
        discovery_mode: discoveryMode,
        requested_count: targetCount,
        discovery_queries: brief.queries,
      },
    })
    .select(CAMPAIGN_SELECT)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: campaignError?.message ?? 'Campaign could not be created' }, { status: 500 })
  }

  const now = new Date().toISOString()
  const discovery = discoveryMode === 'webset'
    ? await createCampaignWebsetWithExa({ brief, count: targetCount, campaignId: campaign.id })
    : await discoverCampaignCandidatesWithExa({ brief, count: targetCount })
  const runId = await createCampaignExploreRun({
    admin,
    userId,
    clientId: activeClientId,
    campaignId: campaign.id,
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
  })
  const materialized = await materializeCampaignCandidates({
    admin,
    supabase,
    userId,
    clientId: activeClientId,
    campaignId: campaign.id,
    runId,
    prompt,
    candidates: discovery.candidates,
    providerRequestId: discovery.requestId ?? discovery.websetSearchId ?? null,
    now,
  })

  await updateCampaignExploreRun({
    admin,
    runId,
    insertedCount: materialized.inserted,
    skippedCount: materialized.skipped,
    generatedCount: discovery.candidates.length,
  })

  await supabase
    .from('gtm_campaigns')
    .update({
      learnings: {
        created_from_prompt: true,
        prompt,
        discovery_provider: 'exa',
        discovery_mode: discoveryMode,
        requested_count: targetCount,
        discovery_queries: brief.queries,
        discovery_status: discovery.status,
        discovery_error: discovery.error ?? null,
        discovery_run_id: runId,
        discovery_request_id: discovery.requestId ?? null,
        discovery_request_ids: discovery.requestIds ?? [],
        exa_webset_id: discovery.websetId ?? null,
        exa_webset_search_id: discovery.websetSearchId ?? null,
        exa_webset_status: discovery.websetStatus ?? null,
        exa_webset_progress: discovery.progress ?? null,
        discovered_count: discovery.candidates.length,
        inserted_count: materialized.inserted,
        skipped_count: materialized.skipped,
        credit_blocked: materialized.creditBlocked,
        last_discovered_at: now,
      },
    })
    .eq('id', campaign.id)
    .eq('user_id', userId)

  const readiness = buildCampaignReadiness({
    campaign,
    targetCount: materialized.targets.length,
    contentCount: 0,
    approvedAssetCount: 0,
  })

  return NextResponse.json({
    ok: true,
    campaign: { ...campaign, readiness },
    discovery: {
      provider: discovery.provider,
      status: discovery.status,
      request_id: discovery.requestId ?? null,
      request_ids: discovery.requestIds ?? [],
      mode: discoveryMode,
      webset_id: discovery.websetId ?? null,
      webset_search_id: discovery.websetSearchId ?? null,
      progress: discovery.progress ?? null,
      error: discovery.error ?? null,
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

function sanitizeChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return ['email', 'linkedin', 'content']
  const channels = Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))).slice(0, 6)
  return channels.length ? channels : ['email', 'linkedin', 'content']
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}
