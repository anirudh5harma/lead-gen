import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizeAutoSendPolicy } from '@/lib/auto-send-policies'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { draftOutreachEmail } from '@/lib/deepseek'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { getDefaultSequenceTemplate } from '@/lib/sequence-templates'
import { resolveOutreachContext, scheduleFollowupAt } from '@/lib/outreach-context'
import { sendAutomationLifecycleEmail } from '@/lib/resend'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_POLICIES_PER_RUN = 30
const MAX_SENDS_PER_POLICY_RUN = 3
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
      .select('id, user_id, client_id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, min_minutes_between_sends, completed_notification_sent_at')
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
      const activeAccount = await oldestEligibleAccount(supabase, userId, policy.connected_account_id)
      if (!activeAccount) {
        skipped++
        continue
      }

      if (activeAccount.last_used_at) {
        const lastUsedMs = new Date(activeAccount.last_used_at).getTime()
        if (Date.now() - lastUsedMs < policy.min_minutes_between_sends * 60_000) {
          skipped++
          continue
        }
      }

      const sentToday = await countSendsToday(supabase, userId, clientId)
      const remainingToday = Math.max(0, policy.daily_send_limit - sentToday)
      if (remainingToday <= 0) {
        skipped++
        continue
      }

      const leads = await loadEligibleAutomationLeads(supabase, {
        userId,
        clientId,
        policy,
        limit: Math.min(MAX_SENDS_PER_POLICY_RUN, remainingToday),
      })

      for (const lead of leads) {
        const didSend = await sendAutomationLead(supabase, {
          userId,
          clientId,
          lead,
          connectedAccountId: policy.connected_account_id,
        })
        if (didSend) sent++
        else skipped++
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
        }
      }
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

async function loadEligibleAutomationLeads(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  params: {
    userId: string
    clientId: string | null
    policy: ReturnType<typeof normalizeAutoSendPolicy>
    limit: number
  },
) {
  const minCreatedAt = new Date(Date.now() - params.policy.max_lead_age_days * 24 * 60 * 60 * 1000).toISOString()
  let query = supabase
    .from('leads')
    .select('id, client_id, origin, target_company, company_domain, relevance_score, relevance_reason, status, contact_email, contact_name, contact_title, contact_verified, feed_session_id, feed_snapshot, created_at')
    .eq('user_id', params.userId)
    .eq('is_unlocked', true)
    .in('origin', params.policy.target_origins)
    .in('status', AUTOMATION_STATUSES)
    .gte('relevance_score', params.policy.min_relevance_score)
    .gte('created_at', minCreatedAt)
    .not('contact_email', 'is', null)
    .eq('contact_verified', true)
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

async function sendAutomationLead(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  params: {
    userId: string
    clientId: string | null
    lead: Record<string, unknown>
    connectedAccountId: string | null
  },
): Promise<boolean> {
  const to = typeof params.lead.contact_email === 'string' ? params.lead.contact_email.trim().toLowerCase() : ''
  if (!to) return false

  const [unsubRes, bounceRes] = await Promise.all([
    supabase.from('unsubscribed_emails').select('id').eq('email', to).maybeSingle(),
    supabase.from('bounced_emails').select('id').eq('email', to).maybeSingle(),
  ])
  if (unsubRes.data || bounceRes.data) return false

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

  const draft = await getOrCreateAutomationDraft(supabase, {
    lead: params.lead,
    profile,
    clientProfile,
    customInstructions: template?.custom_instructions ?? null,
  })

  const outreachContext = resolveOutreachContext({
    userProfile: profile,
    clientProfile,
  })

  const result = await sendWithConnectedAccount({
    userId: params.userId,
    supabase,
    to,
    subject: draft.subject,
    body: draft.body,
    fromName: outreachContext.fromName,
    preferAccountId: params.connectedAccountId,
  })

  if (!result) return false

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

  return true
}

async function getOrCreateAutomationDraft(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  params: {
    lead: Record<string, unknown>
    profile: { company_name?: string | null; website_url?: string | null; services_description?: string | null; calendly_url?: string | null } | null
    clientProfile: { name?: string | null; website_url?: string | null; services_description?: string | null; calendly_url?: string | null } | null
    customInstructions: string | null
  },
): Promise<{ subject: string; body: string }> {
  const { data: existing } = await supabase
    .from('outreach_drafts')
    .select('subject, body')
    .eq('lead_id', params.lead.id as string)
    .maybeSingle()
  if (existing?.subject && existing?.body) return existing

  const signal = normalizeLeadFeedSnapshot(params.lead.feed_snapshot ?? null)
  const outreachContext = resolveOutreachContext({
    userProfile: params.profile,
    clientProfile: params.clientProfile,
  })
  const { subject, body } = await draftOutreachEmail({
    senderCompany: outreachContext.senderCompany,
    senderWebsiteUrl: outreachContext.websiteUrl,
    servicesDescription: outreachContext.servicesDescription,
    stakeholderName: typeof params.lead.contact_name === 'string' && params.lead.contact_name.trim() ? params.lead.contact_name : 'the team',
    stakeholderTitle: typeof params.lead.contact_title === 'string' && params.lead.contact_title.trim() ? params.lead.contact_title : 'Leadership',
    targetCompany: params.lead.target_company as string,
    signalType: signal?.signal_type || 'event',
    signalSummary: signal?.summary || (params.lead.relevance_reason as string | null) || '',
    headline: signal?.headline ?? null,
    fundingAmount: signal?.funding_amount ?? null,
    signalAgeLabel: null,
    articleContext: null,
    calendlyUrl: outreachContext.calendlyUrl,
    customInstructions: params.customInstructions,
  })

  await supabase.from('outreach_drafts').insert({
    lead_id: params.lead.id,
    client_id: params.lead.client_id ?? null,
    subject,
    body,
    stakeholders: [{
      name: params.lead.contact_name ?? '',
      title: params.lead.contact_title ?? '',
      email: params.lead.contact_email ?? '',
      confidence: 'high',
      source: 'automation',
    }],
  })

  return { subject, body }
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
      summary: `Bombsell finished the eligible unlocked leads from ${sessionCount} selected Explore session${sessionCount === 1 ? '' : 's'}. Leads without verified contacts, unsubscribed recipients, bounced emails, or already-sent status were skipped for mailbox safety.`,
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
