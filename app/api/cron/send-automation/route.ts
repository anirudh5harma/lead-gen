import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizeAutoSendPolicy } from '@/lib/auto-send-policies'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { draftOutreachEmail } from '@/lib/deepseek'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'
import { getDefaultSequenceTemplate } from '@/lib/sequence-templates'
import { resolveOutreachContext, scheduleFollowupAt } from '@/lib/outreach-context'
import { sendAutomationLifecycleEmail } from '@/lib/resend'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'
import { finishAgentRun, recordAgentEvent, startAgentRun } from '@/lib/agent-events'
import { buildRecipientGroup, ensureBodyGreetsRecipients, formatRecipientListForLog, type OutreachRecipientGroup } from '@/lib/outreach-recipients'
import { upsertLeadIntoGtmGraph, recordGtmTouchpoint, type LeadGraphResult } from '@/lib/gtm/graph'
import { bodyPreview } from '@/lib/gtm/identity'
import { recordGtmMemory } from '@/lib/gtm/memory'
import { buildOutreachPlan, explainPlanBlock, type OutreachPlan } from '@/lib/gtm/outreach-plan'
import { markLatestOutreachPlanStatus, persistOutreachPlan } from '@/lib/gtm/outreach-plan-store'
import { recordOutcomeLearning } from '@/lib/gtm/outcome-learning'
import { buildGtmContextPack } from '@/lib/gtm/semantic-context'
import { primaryLeadContact, resolveLeadRecipients, upsertOutreachDraft } from '@/lib/outreach-workflow'
import { evaluateOutboundPolicy } from '@/lib/policies/outbound'
import { persistLeadRecipientVerification, validateOutboundRecipients } from '@/lib/outbound-recipient-validation'
import {
  finishWorkflowRun,
  finishWorkflowStep,
  recordToolCall,
  startWorkflowRun,
  startWorkflowStep,
  updateWorkflowCheckpoint,
} from '@/lib/workflows/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_POLICIES_PER_RUN = 30
const MAX_SENDS_PER_POLICY_RUN = 3
const MAX_AUTOPILOT_UNLOCKS_PER_POLICY_RUN = 3
const AUTOMATION_STATUSES = ['new', 'viewed', 'drafted']

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'send_automation')

  try {
    const { data: policies, error: policyError } = await supabase
      .from('auto_send_policies')
      .select('id, user_id, client_id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, explore_daily_send_limit, min_minutes_between_sends, completed_notification_sent_at')
      .eq('enabled', true)
      .order('updated_at', { ascending: true })
      .limit(MAX_POLICIES_PER_RUN)

    if (policyError) throw new Error(policyError.message)

    let sent = 0
    let skipped = 0
    let completed = 0

    for (const row of policies ?? []) {
      const policy = normalizeAutoSendPolicy(row)
      const userId = row.user_id as string
      const clientId = (row as { client_id?: string | null }).client_id ?? null
      const agentRunId = await startAgentRun(supabase, {
        userId,
        clientId,
        agentName: 'sending',
        runType: 'outbound_automation',
        input: {
          origins: policy.target_origins,
          daily_send_limit: policy.daily_send_limit,
          min_relevance_score: policy.min_relevance_score,
        },
      })
      const workflowRunId = await startWorkflowRun(supabase, {
        userId,
        clientId,
        agentRunId,
        workflowType: 'outbound_automation',
        workflowKey: row.id as string,
        idempotencyKey: `outbound_automation:${row.id as string}:${runId}`,
        input: {
          policy_id: row.id,
          origins: policy.target_origins,
          daily_send_limit: policy.daily_send_limit,
          min_relevance_score: policy.min_relevance_score,
        },
      })
      const activeAccount = await oldestEligibleAccount(supabase, userId, policy.connected_account_id)
      if (!activeAccount) {
        await recordAgentEvent(supabase, {
          userId,
          clientId,
          runId: agentRunId,
          agentName: 'safety',
          eventType: 'automation_blocked',
          status: 'blocked',
          title: 'Automation paused: no active inbox',
          body: 'Connect a sending inbox before Bombsell can send from your mailbox.',
        })
        await finishAgentRun(supabase, { runId: agentRunId, status: 'completed', output: { sent: 0, reason: 'no_active_inbox' } })
        await finishWorkflowRun(supabase, {
          runId: workflowRunId,
          status: 'completed',
          output: { sent: 0, reason: 'no_active_inbox' },
          checkpoint: { blocked_at: 'inbox_check' },
        })
        skipped++
        continue
      }

      if (activeAccount.last_used_at) {
        const lastUsedMs = new Date(activeAccount.last_used_at).getTime()
        if (Date.now() - lastUsedMs < policy.min_minutes_between_sends * 60_000) {
          await recordAgentEvent(supabase, {
            userId,
            clientId,
            runId: agentRunId,
            agentName: 'safety',
            eventType: 'mailbox_pacing',
            status: 'skipped',
            title: 'Mailbox pacing held a send',
            body: `Bombsell waited because the selected inbox was used less than ${policy.min_minutes_between_sends} minutes ago.`,
          })
          await finishAgentRun(supabase, { runId: agentRunId, status: 'completed', output: { sent: 0, reason: 'mailbox_pacing' } })
          await finishWorkflowRun(supabase, {
            runId: workflowRunId,
            status: 'completed',
            output: { sent: 0, reason: 'mailbox_pacing' },
            checkpoint: { waiting_on: 'mailbox_pacing', account_id: activeAccount.id },
          })
          skipped++
          continue
        }
      }

      const sentToday = await countSendsToday(supabase, userId, clientId)
      const exploreSentToday = policy.target_origins.includes('explore')
        ? await countExploreSendsToday(supabase, userId, clientId)
        : 0
      const remainingToday = Math.max(0, policy.daily_send_limit - sentToday)
      if (remainingToday <= 0) {
        await recordAgentEvent(supabase, {
          userId,
          clientId,
          runId: agentRunId,
          agentName: 'safety',
          eventType: 'daily_cap_reached',
          status: 'skipped',
          title: 'Daily sending cap reached',
          body: `Bombsell stopped sending after reaching the ${policy.daily_send_limit}/day cap.`,
        })
        await finishAgentRun(supabase, { runId: agentRunId, status: 'completed', output: { sent: 0, reason: 'daily_cap' } })
        await finishWorkflowRun(supabase, {
          runId: workflowRunId,
          status: 'completed',
          output: { sent: 0, reason: 'daily_cap' },
          checkpoint: { blocked_at: 'daily_cap' },
        })
        skipped++
        continue
      }

      const exploreRemaining = Math.max(0, policy.explore_daily_send_limit - exploreSentToday)

      const prepared = await prepareAutopilotLeads(supabase, {
        userId,
        clientId,
        runId: agentRunId,
        policy,
        limit: Math.min(MAX_AUTOPILOT_UNLOCKS_PER_POLICY_RUN, remainingToday),
      })

      let policySent = 0
      const leads: Awaited<ReturnType<typeof loadEligibleAutomationLeads>> = []

      if (policy.target_origins.includes('explore') && exploreRemaining > 0 && remainingToday > 0) {
        const exploreLeads = await loadEligibleAutomationLeads(supabase, {
          userId,
          clientId,
          policy,
          limit: Math.min(MAX_SENDS_PER_POLICY_RUN, exploreRemaining, remainingToday),
          originFilter: 'explore',
        })
        for (const lead of exploreLeads) {
          leads.push(lead)
          policySent++
        }
      }

      if (policy.target_origins.includes('live') && policySent < MAX_SENDS_PER_POLICY_RUN && policySent < remainingToday) {
        const liveRemaining = Math.min(MAX_SENDS_PER_POLICY_RUN - policySent, remainingToday - policySent)
        const liveLeads = await loadEligibleAutomationLeads(supabase, {
          userId,
          clientId,
          policy,
          limit: liveRemaining,
          originFilter: 'live',
        })
        for (const lead of liveLeads) {
          leads.push(lead)
          policySent++
        }
      }

      for (const lead of leads) {
        const didSend = await sendAutomationLead(supabase, {
          userId,
          clientId,
          runId: agentRunId,
          lead,
          connectedAccountId: policy.connected_account_id,
          minMinutesBetweenSends: policy.min_minutes_between_sends,
          requireVerifiedContact: policy.require_verified_contact,
          agentRunId,
          workflowRunId,
        })
        if (didSend) {
          sent++
          if ((lead as { origin?: string }).origin === 'explore') {
            const sessionId = (lead as { feed_session_id?: string }).feed_session_id
            if (sessionId) {
              await updateExploreRunStatus(supabase, sessionId, 'sending')
            }
          }
        } else {
          skipped++
        }
      }

      if (!policy.target_origins.includes('live') && policy.target_origins.includes('explore')) {
        const remaining = await loadEligibleAutomationLeads(supabase, {
          userId,
          clientId,
          policy,
          limit: 1,
        })
        if (remaining.length === 0 && !(row as { completed_notification_sent_at?: string | null }).completed_notification_sent_at) {
          await notifyAutomationCompleted(supabase, userId, row.id as string, policy.target_explore_session_ids.length)
          completed++
          for (const sessionId of policy.target_explore_session_ids) {
            await updateExploreRunStatus(supabase, sessionId, 'completed')
          }
        }
      }

      await finishAgentRun(supabase, {
        runId: agentRunId,
        status: 'completed',
        output: {
          attempted: leads.length,
          unlocked: prepared.unlocked,
          enriched: prepared.enriched,
        },
      })
      await finishWorkflowRun(supabase, {
        runId: workflowRunId,
        status: 'completed',
        output: {
          attempted: leads.length,
          unlocked: prepared.unlocked,
          enriched: prepared.enriched,
        },
        checkpoint: { completed_at: new Date().toISOString() },
      })
    }

    const payload = { sent, skipped, completed }
    await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function oldestEligibleAccount(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
  connectedAccountId: string | null,
): Promise<{ id: string; last_used_at: string | null } | null> {
  let query = supabase
    .from('connected_accounts')
    .select('id, last_used_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1)

  if (connectedAccountId) query = query.eq('id', connectedAccountId)
  const { data } = await query.maybeSingle()
  return data as { id: string; last_used_at: string | null } | null
}

async function countSendsToday(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
  clientId: string | null,
): Promise<number> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  let query = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('sent_at', start.toISOString())

  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  const { count } = await query
  return count ?? 0
}

async function countExploreSendsToday(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
  clientId: string | null,
): Promise<number> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  let query = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('origin', 'explore')
    .gte('sent_at', start.toISOString())

  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  const { count } = await query
  return count ?? 0
}

async function updateExploreRunStatus(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  sessionId: string,
  status: 'sending' | 'completed' | 'paused',
) {
  try {
    await supabase
      .from('explore_runs')
      .update({ autopilot_status: status })
      .eq('id', sessionId)
  } catch (error) {
    console.error('[send-automation] explore run status update failed:', error instanceof Error ? error.message : error)
  }
}

async function loadEligibleAutomationLeads(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  params: {
    userId: string
    clientId: string | null
    policy: ReturnType<typeof normalizeAutoSendPolicy>
    limit: number
    originFilter?: 'live' | 'explore'
  },
) {
  const minCreatedAt = new Date(Date.now() - params.policy.max_lead_age_days * 24 * 60 * 60 * 1000).toISOString()
  const origins = params.originFilter
    ? [params.originFilter]
    : params.policy.target_origins

  let query = supabase
    .from('leads')
    .select('id, client_id, origin, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, contact_email, contact_name, contact_title, contact_verified, feed_session_id, feed_snapshot, created_at')
    .eq('user_id', params.userId)
    .eq('is_unlocked', true)
    .in('origin', origins)
    .in('status', AUTOMATION_STATUSES)
    .gte('relevance_score', params.policy.min_relevance_score)
    .gte('created_at', minCreatedAt)
    .not('contact_email', 'is', null)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(1, params.limit * 5))

  query = params.clientId ? query.eq('client_id', params.clientId) : query.is('client_id', null)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data ?? []).filter(lead => {
    const origin = (lead as { origin?: string | null }).origin ?? 'live'
    if (origin !== 'explore') return true
    const sessionIds = params.policy.target_explore_session_ids
    if (sessionIds.length === 0) return false
    return sessionIds.includes((lead as { feed_session_id?: string | null }).feed_session_id ?? '')
  }).slice(0, params.limit)
}

async function prepareAutopilotLeads(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  params: {
    userId: string
    clientId: string | null
    runId: string | null
    policy: ReturnType<typeof normalizeAutoSendPolicy>
    limit: number
  },
): Promise<{ unlocked: number; enriched: number; skipped: number }> {
  if (params.limit <= 0) return { unlocked: 0, enriched: 0, skipped: 0 }

  const minCreatedAt = new Date(Date.now() - params.policy.max_lead_age_days * 24 * 60 * 60 * 1000).toISOString()
  let query = supabase
    .from('leads')
    .select('id, client_id, origin, target_company, company_domain, relevance_score, relevance_reason, status, feed_session_id, feed_snapshot')
    .eq('user_id', params.userId)
    .eq('is_unlocked', false)
    .in('origin', params.policy.target_origins)
    .in('status', AUTOMATION_STATUSES)
    .gte('relevance_score', params.policy.min_relevance_score)
    .gte('created_at', minCreatedAt)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(1, params.limit * 3))

  query = params.clientId ? query.eq('client_id', params.clientId) : query.is('client_id', null)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const candidates = (data ?? []).filter(lead => {
    const origin = (lead as { origin?: string | null }).origin ?? 'live'
    if (origin !== 'explore') return true
    const sessionIds = params.policy.target_explore_session_ids
    if (sessionIds.length === 0) return false
    return sessionIds.includes((lead as { feed_session_id?: string | null }).feed_session_id ?? '')
  }).slice(0, params.limit)

  if (candidates.length === 0) return { unlocked: 0, enriched: 0, skipped: 0 }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('services_description')
    .eq('user_id', params.userId)
    .maybeSingle()

  let unlocked = 0
  let enriched = 0
  let skipped = 0
  const now = new Date().toISOString()

  for (const lead of candidates) {
    let usedCredit = false
    try {
      usedCredit = await consumeLeadCredit(supabase, {
        userId: params.userId,
        leadId: lead.id as string,
        metadata: { source: 'autopilot_unlock' },
      })
    } catch (creditError) {
      await recordAgentEvent(supabase, {
        userId: params.userId,
        clientId: params.clientId,
        runId: params.runId,
        leadId: lead.id as string,
        agentName: 'safety',
        eventType: 'autopilot_unlock_failed',
        status: 'blocked',
        title: `Autopilot could not unlock ${lead.target_company}`,
        body: creditError instanceof Error ? creditError.message : 'Unable to consume a lead credit.',
      })
      skipped++
      continue
    }

    if (!usedCredit) {
      await recordAgentEvent(supabase, {
        userId: params.userId,
        clientId: params.clientId,
        runId: params.runId,
        leadId: lead.id as string,
        agentName: 'safety',
        eventType: 'autopilot_no_credits',
        status: 'blocked',
        title: 'Autopilot paused: no lead credits',
        body: 'Add credits so Bombsell can unlock high-fit leads before enrichment and sending.',
      })
      skipped++
      break
    }

    const { data: updated, error: updateError } = await supabase
      .from('leads')
      .update({ is_unlocked: true, unlocked_at: now })
      .eq('id', lead.id as string)
      .eq('user_id', params.userId)
      .eq('is_unlocked', false)
      .select('id')
      .maybeSingle()

    if (updateError || !updated) {
      await refundLeadCredit(supabase, {
        userId: params.userId,
        leadId: lead.id as string,
        metadata: { source: 'autopilot_unlock_update_failed' },
      }).catch(() => {})
      skipped++
      continue
    }

    unlocked++
    await recordAgentEvent(supabase, {
      userId: params.userId,
      clientId: params.clientId,
      runId: params.runId,
      leadId: lead.id as string,
      agentName: 'contact',
      eventType: 'lead_unlocked',
      status: 'running',
      title: `Autopilot unlocked ${lead.target_company}`,
      body: 'Bombsell used one lead credit and started verified-contact discovery.',
      metadata: { relevance_score: lead.relevance_score },
    })

    const signal = normalizeLeadFeedSnapshot((lead as { feed_snapshot?: unknown }).feed_snapshot ?? null)
    const resolution = await resolveLeadRecipients(supabase, {
      lead: { ...lead, is_unlocked: true },
      userId: params.userId,
      servicesDescription: (profile as { services_description?: string | null } | null)?.services_description ?? null,
      signalType: signal?.signal_type ?? null,
      signalDomain: signal?.company_domain ?? null,
      consumeCreditIfLocked: false,
      requireVerified: true,
      maxContacts: 3,
    })

    if (resolution.contact) {
      enriched++

      await recordAgentEvent(supabase, {
        userId: params.userId,
        clientId: params.clientId,
        runId: params.runId,
        leadId: lead.id as string,
        agentName: 'contact',
        eventType: 'verified_contact_found',
        status: 'completed',
        title: `Verified contact found for ${lead.target_company}`,
        body: `Bombsell found ${resolution.contact.email.toLowerCase()} and queued the lead for safe sending.`,
        metadata: {
          from_cache: resolution.debug.from_cache,
        },
      })
    } else {
      await refundLeadCredit(supabase, {
        userId: params.userId,
        leadId: lead.id as string,
        metadata: { source: 'autopilot_no_verified_contact_refund' },
      }).catch(() => {})
      await supabase
        .from('leads')
        .update({ is_unlocked: false, unlocked_at: null })
        .eq('id', lead.id as string)
        .eq('user_id', params.userId)
        .is('contact_email', null)
      await recordAgentEvent(supabase, {
        userId: params.userId,
        clientId: params.clientId,
        runId: params.runId,
        leadId: lead.id as string,
        agentName: 'contact',
        eventType: 'no_verified_contact',
        status: 'blocked',
        title: `No verified contact found for ${lead.target_company}`,
        body: 'Bombsell unlocked the lead but did not send because no safe recipient was found.',
        metadata: {
          from_cache: resolution.debug.from_cache,
          resolved_domain: resolution.debug.resolved_domain,
          refunded_credit: true,
        },
      })
    }
  }

  return { unlocked, enriched, skipped }
}

async function sendAutomationLead(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  params: {
    userId: string
    clientId: string | null
    lead: Record<string, unknown>
    runId: string | null
    connectedAccountId: string | null
    minMinutesBetweenSends: number
    requireVerifiedContact: boolean
    agentRunId: string | null
    workflowRunId: string | null
  },
): Promise<boolean> {
  const [{ data: profile }, { data: clientProfile }, template] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, calendly_url')
      .eq('user_id', params.userId)
      .maybeSingle(),
    params.clientId
      ? supabase
          .from('client_accounts')
          .select('name, website_url, services_description, calendly_url')
          .eq('id', params.clientId)
          .eq('user_id', params.userId)
          .maybeSingle()
      : { data: null },
    getDefaultSequenceTemplate(supabase, params.userId, params.clientId),
  ])

  const graphStepId = await startWorkflowStep(supabase, {
    runId: params.workflowRunId,
    userId: params.userId,
    clientId: params.clientId,
    stepKey: `lead:${params.lead.id as string}:graph_sync`,
    input: { lead_id: params.lead.id },
  })
  const graph = await upsertLeadIntoGtmGraph(supabase, {
    id: params.lead.id as string,
    user_id: params.userId,
    client_id: params.clientId,
    target_company: params.lead.target_company as string,
    company_domain: (params.lead.company_domain as string | null | undefined) ?? null,
    relevance_score: (params.lead.relevance_score as number | null | undefined) ?? null,
    relevance_reason: (params.lead.relevance_reason as string | null | undefined) ?? null,
    status: (params.lead.status as string | null | undefined) ?? null,
    is_unlocked: (params.lead.is_unlocked as boolean | null | undefined) ?? true,
    contact_email: (params.lead.contact_email as string | null | undefined) ?? null,
    contact_name: (params.lead.contact_name as string | null | undefined) ?? null,
    contact_title: (params.lead.contact_title as string | null | undefined) ?? null,
    contact_verified: (params.lead.contact_verified as boolean | null | undefined) ?? null,
    origin: (params.lead.origin as string | null | undefined) ?? null,
    feed_snapshot: params.lead.feed_snapshot,
    created_at: (params.lead.created_at as string | null | undefined) ?? null,
  }, {
    agentRunId: params.agentRunId,
    workflowRunId: params.workflowRunId,
  })
  await finishWorkflowStep(supabase, {
    stepId: graphStepId,
    status: graph ? 'completed' : 'skipped',
    output: graph ? {
      account_id: graph.accountId,
      person_id: graph.personId,
      signal_id: graph.signalId,
    } : {},
  })

  const outreachPlan = buildOutreachPlan({
    lead: params.lead,
    mode: 'autonomous',
    senderContext: {
      companyName: (clientProfile as { name?: string | null } | null)?.name ?? (profile as { company_name?: string | null } | null)?.company_name ?? null,
      servicesDescription: (clientProfile as { services_description?: string | null } | null)?.services_description ?? (profile as { services_description?: string | null } | null)?.services_description ?? null,
    },
  })
  const planStepId = await startWorkflowStep(supabase, {
    runId: params.workflowRunId,
    userId: params.userId,
    clientId: params.clientId,
    stepKey: `lead:${params.lead.id as string}:outreach_plan`,
    input: { lead_id: params.lead.id, mode: 'autonomous' },
  })
  if (graph) {
    await persistOutreachPlan(supabase, {
      userId: params.userId,
      clientId: params.clientId,
      leadId: params.lead.id as string,
      accountId: graph.accountId,
      personId: graph.personId,
      plan: outreachPlan,
      agentRunId: params.agentRunId,
      workflowRunId: params.workflowRunId,
    })
    await recordGtmMemory(supabase, {
      userId: params.userId,
      clientId: params.clientId,
      scope: 'entity',
      entityType: 'account',
      entityId: graph.accountId,
      memoryType: 'outreach_plan',
      content: `${outreachPlan.trigger}. ${outreachPlan.angle}`,
      source: 'outreach_planner',
      confidence: outreachPlan.confidence / 100,
      observedAt: new Date().toISOString(),
      provenance: { lead_id: params.lead.id, outreach_plan: outreachPlan },
      agentRunId: params.agentRunId,
      workflowRunId: params.workflowRunId,
    })
  }
  await finishWorkflowStep(supabase, {
    stepId: planStepId,
    status: outreachPlan.requires_review ? 'blocked' : 'completed',
    output: { outreach_plan: outreachPlan },
  })
  if (outreachPlan.requires_review) {
    const reasons = explainPlanBlock(outreachPlan)
    await recordAgentEvent(supabase, {
      userId: params.userId,
      clientId: params.clientId,
      runId: params.runId,
      leadId: params.lead.id as string,
      agentName: 'message',
      eventType: 'outreach_plan_needs_review',
      status: 'blocked',
      title: `Skipped ${params.lead.target_company}: plan needs review`,
      body: `Autonomous sending paused because ${reasons.join(', ') || 'plan confidence was insufficient'}.`,
      metadata: { reasons, outreach_plan: outreachPlan },
    })
    await markLatestOutreachPlanStatus(supabase, {
      userId: params.userId,
      leadId: params.lead.id as string,
      status: 'needs_review',
    })
    if (graph) await recordBlockedTouchpoint(supabase, params, graph, reasons, outreachPlan)
    return false
  }

  const draft = await getOrCreateAutomationDraft(supabase, {
    userId: params.userId,
    clientId: params.clientId,
    lead: params.lead,
    profile,
    clientProfile,
    customInstructions: template?.custom_instructions ?? null,
    outreachPlan,
  })
  if (!draft.recipientGroup) return false

  const recipientEmails = draft.recipientGroup.all.map(recipient => recipient.email.toLowerCase())
  const validationStepId = await startWorkflowStep(supabase, {
    runId: params.workflowRunId,
    userId: params.userId,
    clientId: params.clientId,
    stepKey: `lead:${params.lead.id as string}:recipient_validation`,
    input: {
      lead_id: params.lead.id,
      recipient_count: recipientEmails.length,
    },
  })
  const recipientValidation = await validateOutboundRecipients(recipientEmails)
  const leadContactVerified = await persistLeadRecipientVerification(supabase, {
    leadId: params.lead.id as string,
    userId: params.userId,
    primaryEmail: draft.recipientGroup.to.email,
    validation: recipientValidation,
  })
  await finishWorkflowStep(supabase, {
    stepId: validationStepId,
    status: recipientValidation.safe ? 'completed' : 'blocked',
    output: {
      safe: recipientValidation.safe,
      unsafe_emails: recipientValidation.unsafeEmails,
      statuses: recipientValidation.rows,
    },
  })
  if (!recipientValidation.safe) {
    const reasons = recipientValidation.reasons.length ? recipientValidation.reasons : ['recipient_not_verified']
    await recordAgentEvent(supabase, {
      userId: params.userId,
      clientId: params.clientId,
      leadId: params.lead.id as string,
      runId: params.agentRunId,
      agentName: 'safety',
      eventType: 'recipient_validation_blocked',
      status: 'blocked',
      title: `Skipped ${params.lead.target_company}: recipient validation failed`,
      body: `Unsafe recipient(s): ${recipientValidation.unsafeEmails.join(', ')}.`,
      metadata: { recipients: recipientEmails, unsafe_emails: recipientValidation.unsafeEmails, reasons },
    })
    await markLatestOutreachPlanStatus(supabase, {
      userId: params.userId,
      leadId: params.lead.id as string,
      status: 'blocked',
    })
    if (graph) await recordBlockedTouchpoint(supabase, params, graph, reasons, outreachPlan)
    return false
  }

  const policyStepId = await startWorkflowStep(supabase, {
    runId: params.workflowRunId,
    userId: params.userId,
    clientId: params.clientId,
    stepKey: `lead:${params.lead.id as string}:policy`,
    input: {
      lead_id: params.lead.id,
      recipient_count: recipientEmails.length,
      require_verified_contact: params.requireVerifiedContact,
    },
  })
  const policyDecision = await evaluateOutboundPolicy(supabase, {
    userId: params.userId,
    clientId: params.clientId,
    leadId: params.lead.id as string,
    targetCompany: params.lead.target_company as string,
    companyDomain: (params.lead.company_domain as string | null | undefined) ?? null,
    status: (params.lead.status as string | null | undefined) ?? null,
    isUnlocked: (params.lead.is_unlocked as boolean | null | undefined) ?? true,
    contactVerified: leadContactVerified,
    recipientValidationSafe: recipientValidation.safe && leadContactVerified,
    recipientEmails,
    requireVerifiedContact: params.requireVerifiedContact,
    runId: params.workflowRunId,
    stepId: policyStepId,
    agentRunId: params.agentRunId,
    metadata: { outreach_plan: outreachPlan },
  })
  await finishWorkflowStep(supabase, {
    stepId: policyStepId,
    status: policyDecision.decision === 'allowed' ? 'completed' : 'blocked',
    output: {
      decision: policyDecision.decision,
      reasons: policyDecision.reasons,
    },
  })
  if (policyDecision.decision !== 'allowed') {
    await recordAgentEvent(supabase, {
      userId: params.userId,
      clientId: params.clientId,
      runId: params.runId,
      leadId: params.lead.id as string,
      agentName: 'safety',
      eventType: 'outbound_policy_blocked',
      status: 'blocked',
      title: `Skipped ${params.lead.target_company}: policy blocked send`,
      body: `Blocked by ${policyDecision.reasons.join(', ')}.`,
      metadata: { recipients: recipientEmails, reasons: policyDecision.reasons, outreach_plan: outreachPlan },
    })
    await markLatestOutreachPlanStatus(supabase, {
      userId: params.userId,
      leadId: params.lead.id as string,
      status: 'blocked',
    })
    if (graph) await recordBlockedTouchpoint(supabase, params, graph, policyDecision.reasons, outreachPlan)
    return false
  }

  const outreachContext = resolveOutreachContext({
    userProfile: profile,
    clientProfile,
  })
  const normalizedDraftBody = ensureBodyGreetsRecipients(draft.body, draft.recipientGroup.greeting)

  const sendStepId = await startWorkflowStep(supabase, {
    runId: params.workflowRunId,
    userId: params.userId,
    clientId: params.clientId,
    stepKey: `lead:${params.lead.id as string}:send`,
    input: {
      lead_id: params.lead.id,
      recipient_count: recipientEmails.length,
      connected_account_id: params.connectedAccountId,
    },
  })
  await recordToolCall(supabase, {
    runId: params.workflowRunId,
    stepId: sendStepId,
    agentRunId: params.agentRunId,
    userId: params.userId,
    clientId: params.clientId,
    toolName: 'sendWithConnectedAccount',
    status: 'running',
    toolInput: {
      to: draft.recipientGroup.to.email,
      cc_count: draft.recipientGroup.cc.length,
      prefer_account_id: params.connectedAccountId,
    },
  })
  const result = await sendWithConnectedAccount({
    userId: params.userId,
    supabase,
    to: draft.recipientGroup.to.email,
    cc: draft.recipientGroup.cc.map(recipient => recipient.email),
    subject: draft.subject,
    body: normalizedDraftBody,
    fromName: outreachContext.fromName,
    preferAccountId: params.connectedAccountId,
    notUsedSince: new Date(Date.now() - params.minMinutesBetweenSends * 60_000).toISOString(),
  })

  if (!result) {
    await finishWorkflowStep(supabase, {
      stepId: sendStepId,
      status: 'blocked',
      output: { reason: 'no_eligible_inbox' },
    })
    return false
  }
  await recordToolCall(supabase, {
    runId: params.workflowRunId,
    stepId: sendStepId,
    agentRunId: params.agentRunId,
    userId: params.userId,
    clientId: params.clientId,
    toolName: 'sendWithConnectedAccount',
    status: 'completed',
    output: {
      provider: result.provider,
      from_email: result.fromEmail,
      message_id: result.messageId,
    },
  })

  const now = new Date().toISOString()
  await supabase
    .from('leads')
    .update({
      status: 'sent',
      sent_at: now,
      message_id: result.messageId,
      from_email: result.fromEmail,
      gmail_thread_id: result.threadId,
    })
    .eq('id', params.lead.id as string)
    .eq('user_id', params.userId)

  await supabase.from('scheduled_followups').upsert(
    {
      user_id: params.userId,
      lead_id: params.lead.id,
      scheduled_for: scheduleFollowupAt(),
    },
    { onConflict: 'lead_id' },
  )

  await recordAgentEvent(supabase, {
    userId: params.userId,
    clientId: params.clientId,
    runId: params.runId,
    leadId: params.lead.id as string,
    agentName: 'sending',
    eventType: 'email_sent',
    status: 'completed',
    title: `Sent outreach to ${params.lead.target_company}`,
    body: `Sent from ${result.fromEmail} to ${formatRecipientListForLog(draft.recipientGroup)}. Follow-up was scheduled automatically.`,
    metadata: {
      provider: result.provider,
      message_id: result.messageId,
      thread_id: result.threadId,
      to: draft.recipientGroup.to.email,
      cc: draft.recipientGroup.cc.map(recipient => recipient.email),
      outreach_plan: outreachPlan,
    },
  })

  if (graph) {
    await recordGtmTouchpoint(supabase, {
      userId: params.userId,
      clientId: params.clientId,
      accountId: graph.accountId,
      personId: graph.personId,
      leadId: params.lead.id as string,
      workflowRunId: params.workflowRunId,
      type: 'email',
      status: 'sent',
      subject: draft.subject,
      bodyPreview: bodyPreview(normalizedDraftBody),
      fromEmail: result.fromEmail,
      toEmail: draft.recipientGroup.to.email,
      provider: result.provider,
      messageId: result.messageId,
      occurredAt: now,
      metadata: {
        cc: draft.recipientGroup.cc.map(recipient => recipient.email),
        thread_id: result.threadId,
        outreach_plan: outreachPlan,
      },
    })
    await recordGtmMemory(supabase, {
      userId: params.userId,
      clientId: params.clientId,
      scope: 'entity',
      entityType: 'account',
      entityId: graph.accountId,
      memoryType: 'outreach_sent',
      content: `Sent outreach from ${result.fromEmail} to ${formatRecipientListForLog(draft.recipientGroup)} about "${draft.subject}".`,
      source: 'outbound_automation',
      confidence: 1,
      observedAt: now,
      provenance: {
        lead_id: params.lead.id,
        message_id: result.messageId,
        provider: result.provider,
        outreach_plan: outreachPlan,
      },
      agentRunId: params.agentRunId,
      workflowRunId: params.workflowRunId,
    })
  }

  await recordOutcomeLearning(supabase, {
    userId: params.userId,
    clientId: params.clientId,
    leadId: params.lead.id as string,
    outcome: 'sent',
    observedAt: now,
    metadata: {
      provider: result.provider,
      from_email: result.fromEmail,
      outreach_plan_confidence: outreachPlan.confidence,
    },
    agentRunId: params.agentRunId,
    workflowRunId: params.workflowRunId,
  })
  await markLatestOutreachPlanStatus(supabase, {
    userId: params.userId,
    leadId: params.lead.id as string,
    status: 'sent',
  })

  await finishWorkflowStep(supabase, {
    stepId: sendStepId,
    status: 'completed',
    output: {
      from_email: result.fromEmail,
      provider: result.provider,
      message_id: result.messageId,
    },
  })
  await updateWorkflowCheckpoint(supabase, {
    runId: params.workflowRunId,
    userId: params.userId,
    clientId: params.clientId,
    stepId: sendStepId,
    currentStep: `lead:${params.lead.id as string}:sent`,
    checkpoint: {
      last_sent_lead_id: params.lead.id,
      last_message_id: result.messageId,
      last_from_email: result.fromEmail,
      sent_at: now,
      outreach_plan_confidence: outreachPlan.confidence,
    },
  })

  return true
}

async function recordBlockedTouchpoint(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  params: {
    userId: string
    clientId: string | null
    lead: Record<string, unknown>
    workflowRunId: string | null
  },
  graph: LeadGraphResult,
  reasons: string[],
  outreachPlan?: OutreachPlan,
): Promise<void> {
  await recordGtmTouchpoint(supabase, {
    userId: params.userId,
    clientId: params.clientId,
    accountId: graph.accountId,
    personId: graph.personId,
    leadId: params.lead.id as string,
    workflowRunId: params.workflowRunId,
    type: 'email',
    status: 'blocked',
    toEmail: (params.lead.contact_email as string | null | undefined) ?? null,
    metadata: { reasons, outreach_plan: outreachPlan ?? null },
  })
}

async function getOrCreateAutomationDraft(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  params: {
    userId: string
    clientId: string | null
    lead: Record<string, unknown>
    profile: { company_name?: string | null; website_url?: string | null; services_description?: string | null; calendly_url?: string | null } | null
    clientProfile: { name?: string | null; website_url?: string | null; services_description?: string | null; calendly_url?: string | null } | null
    customInstructions: string | null
    outreachPlan?: OutreachPlan
  },
): Promise<{ subject: string; body: string; recipientGroup: OutreachRecipientGroup | null }> {
  const { data: existing } = await supabase
    .from('outreach_drafts')
    .select('subject, body, stakeholders')
    .eq('lead_id', params.lead.id as string)
    .maybeSingle()
  if (existing?.subject && existing?.body) {
    const existingStakeholders = Array.isArray((existing as { stakeholders?: unknown }).stakeholders)
      ? (existing as { stakeholders: Array<Partial<{ name: string; title: string; email: string; confidence: string; source: string }> | null> }).stakeholders
      : []
    const recipientGroup = buildRecipientGroup(existingStakeholders.length > 0 ? existingStakeholders : [primaryLeadContact(params.lead)])
    if (recipientGroup) {
      const repairedBody = ensureBodyGreetsRecipients(existing.body, recipientGroup.greeting)
      if (repairedBody !== existing.body) {
        await upsertOutreachDraft(supabase, {
          leadId: params.lead.id as string,
          userId: params.userId,
          clientId: (params.lead.client_id as string | null | undefined) ?? null,
          subject: existing.subject,
          body: repairedBody,
          stakeholders: existingStakeholders.map(stakeholder => ({
            name: stakeholder?.name ?? '',
            title: stakeholder?.title ?? 'Decision Maker',
            email: stakeholder?.email ?? '',
            confidence: stakeholder?.confidence ?? 'medium',
            source: stakeholder?.source ?? 'existing_draft',
          })),
          greeting: recipientGroup.greeting,
        }).catch(error => console.error('[send-automation] failed to repair existing draft:', error))
      }
      return {
        subject: existing.subject,
        body: repairedBody,
        recipientGroup,
      }
    }
  }

  const signal = normalizeLeadFeedSnapshot(params.lead.feed_snapshot ?? null)
  const outreachContext = resolveOutreachContext({
    userProfile: params.profile,
    clientProfile: params.clientProfile,
  })
  const contactResolution = await resolveLeadRecipients(supabase, {
    lead: params.lead,
    userId: params.userId,
    servicesDescription: outreachContext.servicesDescription,
    signalType: signal?.signal_type ?? null,
    signalDomain: signal?.company_domain ?? null,
    consumeCreditIfLocked: false,
    requireVerified: true,
    maxContacts: 3,
  })
  const stakeholders = contactResolution.stakeholders
  const recipientGroup = buildRecipientGroup(stakeholders)
  if (!recipientGroup) return { subject: '', body: '', recipientGroup: null }

  const contextPack = await buildGtmContextPack(supabase, {
    userId: params.userId,
    clientId: params.clientId,
    leadId: String(params.lead.id ?? ''),
    query: [
      params.lead.target_company,
      signal?.headline,
      signal?.summary,
      params.lead.relevance_reason,
      params.outreachPlan?.trigger,
    ].filter(value => typeof value === 'string' && value.trim()).join('\n'),
    limit: 8,
  })

  const { subject, body } = await draftOutreachEmail({
    senderCompany: outreachContext.senderCompany,
    senderWebsiteUrl: outreachContext.websiteUrl,
    servicesDescription: outreachContext.servicesDescription,
    stakeholderName: recipientGroup.to.name,
    stakeholderTitle: recipientGroup.titleSummary,
    recipientGreeting: recipientGroup.greeting,
    targetCompany: params.lead.target_company as string,
    signalType: signal?.signal_type || 'event',
    signalSummary: signal?.summary || (params.lead.relevance_reason as string | null) || params.outreachPlan?.trigger || '',
    headline: signal?.headline ?? null,
    fundingAmount: signal?.funding_amount ?? null,
    signalAgeLabel: null,
    articleContext: contextPack.drafting_context || null,
    calendlyUrl: outreachContext.calendlyUrl,
    customInstructions: params.customInstructions,
  })

  const normalizedBody = ensureBodyGreetsRecipients(body, recipientGroup.greeting)

  await upsertOutreachDraft(supabase, {
    leadId: params.lead.id as string,
    userId: params.userId,
    clientId: (params.lead.client_id as string | null | undefined) ?? null,
    subject,
    body: normalizedBody,
    stakeholders,
    greeting: recipientGroup.greeting,
  })

  return { subject, body: normalizedBody, recipientGroup }
}

async function notifyAutomationCompleted(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
  policyId: string,
  sessionCount: number,
) {
  const [{ data: profile }, userResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.auth.admin.getUserById(userId),
  ])
  const email = userResult.data.user?.email
  const now = new Date().toISOString()
  if (email) {
    await sendAutomationLifecycleEmail({
      toEmail: email,
      companyName: (profile as { company_name?: string | null } | null)?.company_name ?? 'your workspace',
      event: 'completed',
      summary: `Bombsell finished the eligible unlocked leads from ${sessionCount} selected batch session${sessionCount === 1 ? '' : 's'}. Leads without verified contacts, unsubscribed recipients, bounced emails, or already-sent status were skipped for mailbox safety.`,
    })
  }
  await supabase
    .from('auto_send_policies')
    .update({
      enabled: false,
      last_completed_at: now,
      completed_notification_sent_at: now,
    })
    .eq('id', policyId)
    .eq('user_id', userId)
}
