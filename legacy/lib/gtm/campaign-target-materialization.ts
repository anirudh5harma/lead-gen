import { buildFeedSessionLabel } from '@/lib/feed-sessions'
import { buildExploreLeadFeedSnapshot, type LeadSignalType } from '@/lib/lead-sources'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import {
  campaignDiscoveryResultKey,
  type CampaignDiscoveryCandidate,
} from '@/lib/gtm/campaign-discovery'

type AdminClient = ReturnType<typeof createAdminClient>

export const CAMPAIGN_DISCOVERY_LEAD_SELECT = 'id, client_id, origin, source_kind, source_record_id, feed_session_id, feed_session_label, feed_session_started_at, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, unlocked_at, created_at, sent_at, replied_at, booked_at, contact_email, contact_name, contact_title, feed_snapshot'

export async function createCampaignExploreRun(params: {
  admin: AdminClient
  userId: string
  clientId: string | null
  campaignId: string
  prompt: string
  segment: string
  status: 'running' | 'completed' | 'failed'
  generatedCount?: number
  errorMessage?: string | null
  completedAt?: string | null
}) {
  const { data } = await params.admin
    .from('explore_runs')
    .insert({
      user_id: params.userId,
      client_id: params.clientId,
      prompt: params.prompt,
      icp_hint: `Campaign ${params.campaignId}: ${params.segment}`,
      seller_profile_snapshot: null,
      workspace_icp_snapshot: null,
      used_workspace_icp: false,
      status: params.status,
      generated_count: params.generatedCount ?? 0,
      inserted_count: 0,
      skipped_count: 0,
      error_message: params.errorMessage ?? null,
      completed_at: params.completedAt ?? null,
    })
    .select('id')
    .single()

  return data?.id ?? null
}

export async function updateCampaignExploreRun(params: {
  admin: AdminClient
  runId: string | null
  status?: 'running' | 'completed' | 'failed'
  generatedCount?: number
  insertedCount?: number
  skippedCount?: number
  errorMessage?: string | null
  completedAt?: string | null
}) {
  if (!params.runId) return
  const update: Record<string, unknown> = {}
  if (params.status) update.status = params.status
  if (typeof params.generatedCount === 'number') update.generated_count = params.generatedCount
  if (typeof params.insertedCount === 'number') update.inserted_count = params.insertedCount
  if (typeof params.skippedCount === 'number') update.skipped_count = params.skippedCount
  if ('errorMessage' in params) update.error_message = params.errorMessage ?? null
  if ('completedAt' in params) update.completed_at = params.completedAt ?? null
  if (Object.keys(update).length === 0) return
  await params.admin.from('explore_runs').update(update).eq('id', params.runId)
}

export async function materializeCampaignCandidates(params: {
  admin: AdminClient
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  clientId: string | null
  campaignId: string
  runId: string | null
  sessionLabel?: string | null
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
  const sessionLabel = params.sessionLabel ?? buildFeedSessionLabel({
    origin: 'explore',
    startedAt: params.now,
    prompt: params.prompt,
  })

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
      .select(CAMPAIGN_DISCOVERY_LEAD_SELECT)
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
        console.error('[campaign-discovery] credit consume error:', error instanceof Error ? error.message : error)
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
          feed_session_label: sessionLabel,
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
        .select(CAMPAIGN_DISCOVERY_LEAD_SELECT)
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
          console.error('[campaign-discovery] credit refund error:', error instanceof Error ? error.message : error)
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
