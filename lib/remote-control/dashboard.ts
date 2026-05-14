import type { SupabaseClient } from '@supabase/supabase-js'
import type { Lead } from '@/lib/leads'
import {
  interpretDashboardCommand,
  type DashboardCommand,
} from '@/lib/dashboard-command-layer'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'
import { loadAccessibleLead } from '@/lib/lead-access'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { resolveOutreachContext } from '@/lib/outreach-context'
import { resolveLeadRecipients, upsertOutreachDraft, type OutreachStakeholder } from '@/lib/outreach-workflow'
import { draftOutreachEmail, repairOutreachBodyTriggerOpening } from '@/lib/deepseek'
import { buildGtmContextPack } from '@/lib/gtm/semantic-context'
import { evaluateOutreachDraftQuality } from '@/lib/gtm/draft-eval'
import { upsertGtmEvalTrace } from '@/lib/gtm/eval-traces'
import { buildRecipientGroup, ensureBodyGreetsRecipients } from '@/lib/outreach-recipients'
import { validateOutboundRecipients, persistLeadRecipientVerification } from '@/lib/outbound-recipient-validation'
import { evaluateOutboundPolicy } from '@/lib/policies/outbound'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { emitCrmLeadEvent } from '@/lib/crm-sync'
import { recordOutcomeLearning, type GtmOutcome } from '@/lib/gtm/outcome-learning'

export interface RemoteCommandResult {
  ok: boolean
  transcript: string
  response: string
  command?: DashboardCommand
  needsConfirmation?: boolean
}

type ServiceSupabase = SupabaseClient

const LEAD_SELECT = `
  id,
  user_id,
  client_id,
  origin,
  source_kind,
  target_company,
  company_domain,
  relevance_score,
  relevance_reason,
  status,
  is_unlocked,
  unlocked_at,
  created_at,
  sent_at,
  replied_at,
  booked_at,
  contact_email,
  contact_name,
  contact_title,
  contact_verified,
  feed_snapshot
`

export async function handleRemoteDashboardCommand(
  supabase: ServiceSupabase,
  input: {
    userId: string
    clientId?: string | null
    transcript: string
    confirmed?: boolean
  },
): Promise<RemoteCommandResult> {
  const transcript = input.transcript.trim()
  if (!transcript) return { ok: false, transcript, response: 'No command text was received.' }

  const cleanTranscript = stripConfirmationPrefix(transcript)
  const confirmed = input.confirmed === true || cleanTranscript !== transcript
  const leads = await loadRemoteLeads(supabase, input.userId, input.clientId ?? null)
  const interpretation = interpretDashboardCommand({
    transcript: cleanTranscript,
    activeView: 'home',
    leads,
  })

  if (interpretation.kind === 'unsupported') {
    return { ok: false, transcript, response: interpretation.reason }
  }
  if (interpretation.kind === 'clarify') {
    return {
      ok: false,
      transcript,
      response: `${interpretation.reason} Reply with one of: ${interpretation.options.map(option => option.label).join(', ')}.`,
    }
  }

  const command = interpretation.command
  if ('requiresConfirmation' in command && command.requiresConfirmation && !confirmed) {
    return {
      ok: false,
      transcript,
      command,
      needsConfirmation: true,
      response: `Confirmation required. Reply: confirm ${cleanTranscript}`,
    }
  }

  const response = await executeRemoteCommand(supabase, input.userId, command)
  return { ok: true, transcript, command, response }
}

async function loadRemoteLeads(
  supabase: ServiceSupabase,
  userId: string,
  clientId: string | null,
): Promise<Lead[]> {
  const profileClientId = clientId ?? await loadActiveClientId(supabase, userId)
  let query = supabase
    .from('leads')
    .select(LEAD_SELECT)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(200)

  query = profileClientId
    ? query.eq('client_id', profileClientId)
    : query.eq('user_id', userId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Lead[]
}

async function loadActiveClientId(supabase: ServiceSupabase, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('active_client_id')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as { active_client_id?: string | null } | null)?.active_client_id ?? null
}

async function executeRemoteCommand(
  supabase: ServiceSupabase,
  userId: string,
  command: DashboardCommand,
): Promise<string> {
  if (command.type === 'navigate') return `${command.summary}. Open the dashboard to view it.`
  if (command.type === 'refresh') return 'Dashboard data will refresh the next time you open it.'
  if (command.type === 'search') return `Search is dashboard-only. Open Bombsell and search for "${command.query}".`

  if (command.action === 'open' || command.action === 'review') {
    return `${command.summary}. Open the dashboard lead drawer to review details.`
  }

  if (command.action === 'unlock') return unlockLead(supabase, userId, command.leadId)
  if (command.action === 'draft') return prepareDraft(supabase, userId, command.leadId)
  if (command.action === 'send') return sendDraft(supabase, userId, command.leadId)
  if (command.action === 'status') return updateLeadStatus(supabase, userId, command.leadId, command.status)

  return 'Command recognized, but no remote action is available for it yet.'
}

async function unlockLead(supabase: ServiceSupabase, userId: string, leadId: string): Promise<string> {
  const { lead, error } = await loadAccessibleLead<Lead & { user_id: string; contact_verified?: boolean | null }>(supabase, {
    userId,
    leadId,
    select: LEAD_SELECT,
  })
  if (error) throw new Error(error)
  if (!lead) throw new Error('Lead not found.')
  if (lead.is_unlocked) return `${lead.target_company} is already unlocked.`

  const usedCredit = await consumeLeadCredit(supabase, {
    userId,
    leadId,
    metadata: { source: 'remote_control_unlock' },
  })
  if (!usedCredit) throw new Error('You need lead credits to unlock this lead.')

  const unlockedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('leads')
    .update({ is_unlocked: true, unlocked_at: unlockedAt })
    .eq('id', leadId)
  if (updateError) {
    await refundLeadCredit(supabase, {
      userId,
      leadId,
      metadata: { source: 'remote_control_unlock_failed' },
    }).catch(() => {})
    throw new Error(updateError.message)
  }

  return `Unlocked ${lead.target_company}.`
}

async function prepareDraft(supabase: ServiceSupabase, userId: string, leadId: string): Promise<string> {
  const draft = await ensureRemoteDraft(supabase, userId, leadId)
  return `Prepared draft for ${draft.targetCompany}: "${draft.subject}" to ${draft.to ?? 'an unresolved recipient'}.`
}

async function sendDraft(supabase: ServiceSupabase, userId: string, leadId: string): Promise<string> {
  const draft = await ensureRemoteDraft(supabase, userId, leadId)
  if (!draft.to || !draft.subject || !draft.body) throw new Error('Draft is missing recipient, subject, or body.')

  const validation = await validateOutboundRecipients([draft.to, ...draft.cc])
  const contactVerified = await persistLeadRecipientVerification(supabase, {
    leadId,
    userId,
    primaryEmail: draft.to,
    validation,
  })

  const policy = await evaluateOutboundPolicy(supabase, {
    userId,
    clientId: draft.clientId,
    leadId,
    targetCompany: draft.targetCompany,
    companyDomain: draft.companyDomain,
    status: draft.leadStatus,
    isUnlocked: true,
    contactVerified,
    recipientValidationSafe: validation.safe,
    recipientEmails: [draft.to, ...draft.cc],
    requireVerifiedContact: true,
    metadata: { source: 'remote_control' },
  })
  if (policy.decision !== 'allowed') {
    throw new Error(`Remote send blocked: ${policy.reasons.join(', ')}`)
  }

  const senderContext = await loadSenderContext(supabase, userId, draft.clientId)
  const sendResult = await sendWithConnectedAccount({
    userId,
    supabase,
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    body: draft.body,
    fromName: senderContext.senderCompany,
  })
  if (!sendResult) throw new Error('No connected sending account is available.')

  const sentAt = new Date().toISOString()
  const { error } = await supabase
    .from('leads')
    .update({
      status: 'sent',
      sent_at: sentAt,
      contact_email: draft.to,
      contact_name: draft.toName,
      is_unlocked: true,
    })
    .eq('id', leadId)
  if (error) throw new Error(error.message)

  emitCrmLeadEvent({
    userId,
    clientId: draft.clientId,
    eventType: 'lead.updated',
    payload: { lead_id: leadId, target_company: draft.targetCompany, status: 'sent' },
  }).catch(() => {})
  recordOutcomeLearning(supabase, {
    userId,
    clientId: draft.clientId,
    leadId,
    outcome: 'sent',
    observedAt: sentAt,
    metadata: { source: 'remote_control', message_id: sendResult.messageId },
  }).catch(() => {})

  return `Sent outreach for ${draft.targetCompany} to ${draft.to}.`
}

async function updateLeadStatus(
  supabase: ServiceSupabase,
  userId: string,
  leadId: string,
  status: 'viewed' | 'dismissed' | 'booked' | 'sent' | 'replied',
): Promise<string> {
  const { lead, error: accessError } = await loadAccessibleLead<Lead & { user_id: string; client_id?: string | null }>(supabase, {
    userId,
    leadId,
    select: 'id, user_id, client_id, target_company, status',
  })
  if (accessError) throw new Error(accessError)
  if (!lead) throw new Error('Lead not found.')

  const updates: Record<string, unknown> = { status }
  const now = new Date().toISOString()
  if (status === 'sent') updates.sent_at = now
  if (status === 'replied') updates.replied_at = now
  if (status === 'booked') updates.booked_at = now

  const { error } = await supabase.from('leads').update(updates).eq('id', leadId)
  if (error) throw new Error(error.message)

  emitCrmLeadEvent({
    userId,
    clientId: lead.client_id ?? null,
    eventType: status === 'replied' ? 'lead.replied' : status === 'booked' ? 'lead.booked' : 'lead.updated',
    payload: { lead_id: leadId, target_company: lead.target_company, status },
  }).catch(() => {})
  const outcome = statusToLearningOutcome(status)
  if (outcome) {
    recordOutcomeLearning(supabase, {
      userId,
      clientId: lead.client_id ?? null,
      leadId,
      outcome,
      observedAt: now,
      metadata: { source: 'remote_control' },
    }).catch(() => {})
  }

  return `Marked ${lead.target_company} ${status}.`
}

async function ensureRemoteDraft(
  supabase: ServiceSupabase,
  userId: string,
  leadId: string,
): Promise<{
  targetCompany: string
  companyDomain: string | null
  clientId: string | null
  leadStatus: string | null
  subject: string
  body: string
  to: string | null
  toName: string | null
  cc: string[]
}> {
  const { lead, error: leadError } = await loadAccessibleLead<Lead & {
    user_id: string
    client_id: string | null
    contact_verified?: boolean | null
  }>(supabase, {
    userId,
    leadId,
    select: LEAD_SELECT,
  })
  if (leadError) throw new Error(leadError)
  if (!lead) throw new Error('Lead not found.')

  const { data: existingDraft } = await supabase
    .from('outreach_drafts')
    .select('subject, body, stakeholders')
    .eq('lead_id', leadId)
    .maybeSingle()

  const senderContext = await loadSenderContext(supabase, userId, lead.client_id ?? null)
  const signal = normalizeLeadFeedSnapshot(lead.feed_snapshot ?? null)
  const contactResolution = await resolveLeadRecipients(supabase, {
    lead,
    userId,
    servicesDescription: senderContext.servicesDescription,
    signalType: signal?.signal_type ?? null,
    signalDomain: signal?.company_domain ?? null,
    consumeCreditIfLocked: true,
    creditSource: 'remote_control_draft_unlock',
    refundCreditWhenNoContact: true,
    preferLeadContact: false,
    maxContacts: 3,
  })

  const existingStakeholders = normalizeStakeholders(
    Array.isArray((existingDraft as { stakeholders?: unknown } | null)?.stakeholders)
      ? (existingDraft as { stakeholders: Array<{ name?: string; title?: string; email?: string; confidence?: string; source?: string }> }).stakeholders
      : [],
  )
  const stakeholders = contactResolution.stakeholders.length > 0
    ? contactResolution.stakeholders.slice(0, 3)
    : existingStakeholders.slice(0, 3)
  const recipientGroup = buildRecipientGroup(stakeholders) ?? contactResolution.recipientGroup
  const cc = (stakeholders.length > 0 ? stakeholders.slice(1) : [])
    .map(stakeholder => stakeholder.email)
    .filter((email): email is string => Boolean(email))

  if ((existingDraft as { subject?: string; body?: string } | null)?.subject && (existingDraft as { subject?: string; body?: string } | null)?.body) {
    const subject = String((existingDraft as { subject: string }).subject)
    const repairedBody = ensureBodyGreetsRecipients(
      repairOutreachBodyTriggerOpening(String((existingDraft as { body: string }).body), {
        firstName: recipientGroup?.greeting ?? 'Hi there',
        recipientGreeting: recipientGroup?.greeting ?? 'Hi there',
        targetCompany: lead.target_company,
      }),
      recipientGroup?.greeting ?? 'Hi there',
    )
    return {
      targetCompany: lead.target_company,
      companyDomain: lead.company_domain ?? null,
      clientId: lead.client_id ?? null,
      leadStatus: lead.status ?? null,
      subject,
      body: repairedBody,
      to: recipientGroup?.to.email ?? lead.contact_email ?? null,
      toName: recipientGroup?.to.name ?? lead.contact_name ?? null,
      cc,
    }
  }

  const contextPack = await buildGtmContextPack(supabase, {
    userId,
    clientId: lead.client_id ?? null,
    leadId,
    query: [lead.target_company, signal?.headline, signal?.summary, lead.relevance_reason]
      .filter(value => typeof value === 'string' && value.trim())
      .join('\n'),
    limit: 8,
  })

  const generated = await draftOutreachEmail({
    senderCompany: senderContext.senderCompany,
    senderWebsiteUrl: senderContext.websiteUrl,
    servicesDescription: senderContext.servicesDescription,
    stakeholderName: recipientGroup?.to.name || 'there',
    stakeholderTitle: recipientGroup?.titleSummary || 'leadership team',
    recipientGreeting: recipientGroup?.greeting || 'Hi there',
    targetCompany: lead.target_company,
    signalType: signal?.signal_type || 'event',
    signalSummary: signal?.summary || lead.relevance_reason || '',
    headline: signal?.headline ?? null,
    fundingAmount: signal?.funding_amount ?? null,
    signalAgeLabel: null,
    articleContext: contextPack.drafting_context || null,
    calendlyUrl: senderContext.calendlyUrl,
    customInstructions: null,
  })

  const body = ensureBodyGreetsRecipients(generated.body, recipientGroup?.greeting || 'Hi there')
  const qualityEval = evaluateOutreachDraftQuality({
    subject: generated.subject,
    body,
    greeting: recipientGroup?.greeting || 'Hi there',
    targetCompany: lead.target_company,
    signalType: signal?.signal_type ?? null,
    signalSummary: signal?.summary ?? lead.relevance_reason ?? null,
  })

  await upsertOutreachDraft(supabase, {
    leadId,
    userId,
    clientId: lead.client_id ?? null,
    subject: generated.subject,
    body,
    stakeholders,
    greeting: recipientGroup?.greeting || 'Hi there',
    qualityScore: qualityEval.score,
    qualityChecks: qualityEval.checks,
    qualityCheckedAt: new Date().toISOString(),
    qualityVersion: qualityEval.version,
  })
  await upsertGtmEvalTrace(supabase, {
    userId,
    clientId: lead.client_id ?? null,
    leadId,
    traceType: 'draft_quality',
    status: qualityEval.score >= 70 ? 'passed' : 'warning',
    reasons: qualityEval.failed,
    draftQualityScore: qualityEval.score,
    metadata: { source: 'remote_control', quality_version: qualityEval.version },
  })

  return {
    targetCompany: lead.target_company,
    companyDomain: lead.company_domain ?? null,
    clientId: lead.client_id ?? null,
    leadStatus: lead.status ?? null,
    subject: generated.subject,
    body,
    to: recipientGroup?.to.email ?? null,
    toName: recipientGroup?.to.name ?? null,
    cc,
  }
}

async function loadSenderContext(
  supabase: ServiceSupabase,
  userId: string,
  clientId: string | null,
) {
  const [{ data: profile }, { data: clientProfile }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, calendly_url')
      .eq('user_id', userId)
      .maybeSingle(),
    clientId
      ? supabase
          .from('client_accounts')
          .select('name, website_url, services_description, calendly_url')
          .eq('id', clientId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  return resolveOutreachContext({ userProfile: profile, clientProfile })
}

function stripConfirmationPrefix(value: string): string {
  return value.replace(/^\s*(confirm|confirmed|yes|approve|do it|go ahead|proceed)\s+/i, '').trim()
}

function statusToLearningOutcome(status: string): GtmOutcome | null {
  if (status === 'sent') return 'sent'
  if (status === 'replied') return 'replied'
  if (status === 'booked') return 'booked'
  if (status === 'dismissed') return 'dismissed'
  return null
}

function normalizeStakeholders(
  stakeholders: Array<{ name?: string; title?: string; email?: string; confidence?: string; source?: string }>,
): OutreachStakeholder[] {
  return stakeholders.map(stakeholder => ({
    name: stakeholder.name ?? '',
    title: stakeholder.title ?? '',
    email: stakeholder.email ?? '',
    confidence: stakeholder.confidence ?? 'medium',
    source: stakeholder.source ?? 'remote_control',
  }))
}
