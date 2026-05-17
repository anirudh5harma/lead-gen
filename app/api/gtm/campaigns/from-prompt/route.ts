import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { requirePlan } from '@/lib/api-plan-guard'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { buildFeedSessionLabel } from '@/lib/feed-sessions'
import { buildExploreLeadFeedSnapshot, type LeadSignalType } from '@/lib/lead-sources'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'
import { buildCampaignReadiness } from '@/lib/gtm/campaigns'
import {
  buildCampaignBriefFromPrompt,
  campaignDiscoveryResultKey,
  type CampaignDiscoveryCandidate,
} from '@/lib/gtm/campaign-discovery'
import { discoverCampaignCandidatesWithExa } from '@/lib/exa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const CAMPAIGN_SELECT = 'id, name, objective, segment, trigger, narrative, offer, success_metric, channels, status, starts_at, ends_at, learnings, created_at, updated_at'
const LEAD_SELECT = 'id, client_id, origin, source_kind, source_record_id, feed_session_id, feed_session_label, feed_session_started_at, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, unlocked_at, created_at, sent_at, replied_at, booked_at, contact_email, contact_name, contact_title, feed_snapshot'

type AdminClient = ReturnType<typeof createAdminClient>

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

  const targetCount = boundedNumber(body?.target_count, 1, 20, 10)
  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const brief = buildCampaignBriefFromPrompt(prompt)
  const channels = sanitizeChannels(body?.channels?.length ? body.channels : brief.channels)

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
        discovery_queries: brief.queries,
      },
    })
    .select(CAMPAIGN_SELECT)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: campaignError?.message ?? 'Campaign could not be created' }, { status: 500 })
  }

  const discovery = await discoverCampaignCandidatesWithExa({ brief, count: targetCount })
  const now = new Date().toISOString()
  const { data: run } = await admin
    .from('explore_runs')
    .insert({
      user_id: userId,
      client_id: activeClientId,
      prompt,
      icp_hint: `Campaign ${campaign.id}: ${brief.segment}`,
      seller_profile_snapshot: null,
      workspace_icp_snapshot: null,
      used_workspace_icp: false,
      status: discovery.status === 'provider_error' ? 'failed' : 'completed',
      generated_count: discovery.candidates.length,
      inserted_count: 0,
      skipped_count: 0,
      error_message: discovery.error ?? null,
      completed_at: now,
    })
    .select('id')
    .single()

  const runId = run?.id ?? null
  const sessionLabel = buildFeedSessionLabel({
    origin: 'explore',
    startedAt: now,
    prompt,
  })
  const materialized = await materializeCampaignCandidates({
    admin,
    supabase,
    userId,
    clientId: activeClientId,
    campaignId: campaign.id,
    runId,
    sessionLabel,
    prompt,
    candidates: discovery.candidates,
    providerRequestId: discovery.requestId ?? null,
    now,
  })

  if (runId) {
    await admin
      .from('explore_runs')
      .update({
        inserted_count: materialized.inserted,
        skipped_count: materialized.skipped,
        generated_count: discovery.candidates.length,
      })
      .eq('id', runId)
  }

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

async function materializeCampaignCandidates(params: {
  admin: AdminClient
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  clientId: string | null
  campaignId: string
  runId: string | null
  sessionLabel: string
  prompt: string
  candidates: CampaignDiscoveryCandidate[]
  providerRequestId: string | null
  now: string
}) {
  const leads: unknown[] = []
  const targets: unknown[] = []
  let inserted = 0
  let skipped = 0
  let creditsUsed = 0
  let creditBlocked = 0

  for (const candidate of params.candidates) {
    const target = await saveExploreTarget(params.admin, {
      run_id: params.runId,
      user_id: params.userId,
      client_id: params.clientId,
      result_key: campaignDiscoveryResultKey({
        userId: params.userId,
        clientId: params.clientId,
        campaignId: params.campaignId,
        companyName: candidate.company_name,
        companyDomain: candidate.company_domain,
      }),
      company_name: candidate.company_name,
      company_domain: candidate.company_domain,
      signal_type: candidate.signal_type,
      headline: candidate.headline,
      summary: candidate.summary,
      relevance_reason: candidate.relevance_reason,
      relevance_score: candidate.relevance_score,
      prompt: params.prompt,
      icp_hint: `campaign:${params.campaignId}`,
      source_payload: {
        provider: candidate.provider,
        provider_request_id: params.providerRequestId,
        provider_record_id: candidate.provider_record_id,
        source_url: candidate.source_url,
        source_name: candidate.source_name,
        published_at: candidate.published_at,
        evidence: candidate.evidence,
        raw: candidate.raw_payload,
      },
      updated_at: params.now,
    })

    if (!target.data?.id) {
      skipped++
      continue
    }

    const { data: existingLead } = await params.admin
      .from('leads')
      .select(LEAD_SELECT)
      .eq('user_id', params.userId)
      .eq('source_kind', 'explore_target')
      .eq('source_record_id', target.data.id)
      .maybeSingle()

    let lead = existingLead
    if (!lead) {
      let usedCredit = false
      try {
        usedCredit = await consumeLeadCredit(params.supabase, {
          userId: params.userId,
          metadata: {
            source: 'campaign_prompt_exa',
            campaign_id: params.campaignId,
            company_name: candidate.company_name,
            company_domain: candidate.company_domain,
          },
        })
      } catch (error) {
        console.error('[campaign-from-prompt] credit consume error:', error instanceof Error ? error.message : error)
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
        signalType: candidate.signal_type as LeadSignalType,
        headline: candidate.headline,
        summary: candidate.summary,
        companyDomain: candidate.company_domain,
        prompt: params.prompt,
        icpHint: `campaign:${params.campaignId}`,
        usedWorkspaceIcp: false,
        sourceUrl: candidate.source_url ?? `explore://target/${target.data.id}`,
        sourceName: candidate.source_name || 'exa_search',
        publishedAt: candidate.published_at ?? params.now,
      })

      const insertedLead = await params.admin
        .from('leads')
        .insert({
          user_id: params.userId,
          client_id: params.clientId,
          signal_id: null,
          origin: 'explore',
          feed_session_id: params.runId,
          feed_session_label: params.sessionLabel,
          feed_session_started_at: params.now,
          source_kind: 'explore_target',
          source_record_id: target.data.id,
          target_company: candidate.company_name,
          company_domain: candidate.company_domain,
          relevance_score: candidate.relevance_score,
          relevance_reason: `Campaign discovery: ${candidate.relevance_reason}`.slice(0, 1000),
          status: 'new',
          is_unlocked: true,
          unlocked_at: params.now,
          feed_snapshot: snapshot,
          match_debug: {
            matched_via: 'campaign_prompt_exa',
            campaign_id: params.campaignId,
            prompt: params.prompt,
            source_kind: 'explore_target',
            provider: candidate.provider,
            provider_request_id: params.providerRequestId,
            evidence: candidate.evidence,
          },
        })
        .select(LEAD_SELECT)
        .single()

      if (insertedLead.error || !insertedLead.data) {
        await refundLeadCredit(params.supabase, {
          userId: params.userId,
          metadata: {
            source: 'campaign_prompt_exa_insert_failed_refund',
            campaign_id: params.campaignId,
            company_name: candidate.company_name,
            company_domain: candidate.company_domain,
          },
        }).catch(error => {
          console.error('[campaign-from-prompt] credit refund error:', error instanceof Error ? error.message : error)
        })
        creditsUsed = Math.max(0, creditsUsed - 1)
        skipped++
        continue
      }

      lead = insertedLead.data
      inserted++
    } else {
      skipped++
    }

    leads.push(lead)
    const targetRow = await params.admin
      .from('gtm_campaign_targets')
      .upsert({
        campaign_id: params.campaignId,
        user_id: params.userId,
        client_id: params.clientId,
        lead_id: lead.id,
        status: 'proposed',
        rationale: candidate.relevance_reason,
      }, { onConflict: 'campaign_id,lead_id' })
      .select('id, campaign_id, lead_id, status, rationale, created_at')
      .single()
    if (!targetRow.error && targetRow.data) targets.push(targetRow.data)
  }

  return { leads, targets, inserted, skipped, creditsUsed, creditBlocked }
}

async function saveExploreTarget(
  admin: AdminClient,
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
    return await admin
      .from('explore_targets')
      .update(payload)
      .eq('id', existing.id)
      .select('id')
      .single()
  }

  const inserted = await admin
    .from('explore_targets')
    .insert(payload)
    .select('id')
    .single()

  if (!inserted.error || inserted.error.code !== '23505') return inserted
  return await admin
    .from('explore_targets')
    .select('id')
    .eq('result_key', payload.result_key)
    .single()
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
