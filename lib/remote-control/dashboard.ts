import type { SupabaseClient } from '@supabase/supabase-js'
import type { Lead } from '@/lib/leads'
import type { DashboardCommand, LeadStatusCommand } from '@/lib/dashboard-command-layer'
import { classifyVoiceIntent } from '@/lib/voice-intent-layer'
import type { VoiceSentiment } from '@/lib/voice-intent-layer'
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
import { dispatchTask } from '@/lib/agents/core/supervisor'
import {
  formatContentIdeasForChat,
  formatLeadDetailsForChat,
  formatPipelineForChat,
  numberedItem,
  rankRemotePipelineLeads,
  type RemoteContentIdea,
} from './conversation'

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

  const activeClientId = input.clientId ?? await loadActiveClientId(supabase, input.userId)
  let cachedLeads: Lead[] | null = null
  const getLeads = async () => {
    cachedLeads ??= await loadRemoteLeads(supabase, input.userId, activeClientId)
    return cachedLeads
  }

  // Classify the utterance using LLM (with fast-path bypass for confirm/cancel)
  const classification = await classifyVoiceIntent(cleanTranscript)
  const vi = classification.intent

  switch (vi.intent) {
    // ── Pipeline ──────────────────────────────────────────────────────────
    case 'list_pipeline': {
      const leads = await getLeads()
      return { ok: true, transcript, response: formatPipelineForChat(leads) }
    }

    case 'lead_details': {
      const lead = await resolveLeadByVoiceIntent(vi, await getLeads(), supabase, input.userId)
      if ('response' in lead) return lead
      return {
        ok: true,
        transcript,
        response: formatLeadDetailsForChat(lead, vi.index),
      }
    }

    case 'lead_draft': {
      const lead = await resolveLeadByVoiceIntent(vi, await getLeads(), supabase, input.userId)
      if ('response' in lead) return lead
      const draft = await ensureRemoteDraft(supabase, input.userId, lead.id)
      return {
        ok: true,
        transcript,
        response: `Prepared draft for ${draft.targetCompany}: "${draft.subject}" to ${draft.to ?? 'an unresolved recipient'}.`,
      }
    }

    case 'lead_unlock': {
      const lead = await resolveLeadByVoiceIntent(vi, await getLeads(), supabase, input.userId)
      if ('response' in lead) return lead
      const response = await unlockLead(supabase, input.userId, lead.id)
      return { ok: true, transcript, response }
    }

    case 'lead_send': {
      const lead = await resolveLeadByVoiceIntent(vi, await getLeads(), supabase, input.userId)
      if ('response' in lead) return lead
      if (!confirmed) {
        return {
          ok: false,
          transcript,
          needsConfirmation: true,
          response: `Confirmation required. Reply: confirm ${cleanTranscript}`,
        }
      }
      const response = await sendDraft(supabase, input.userId, lead.id)
      return { ok: true, transcript, response }
    }

    case 'lead_status': {
      const status = vi.status ?? 'viewed'
      const lead = await resolveLeadByVoiceIntent(vi, await getLeads(), supabase, input.userId)
      if ('response' in lead) return lead
      if (status === 'dismissed' && !confirmed) {
        return {
          ok: false,
          transcript,
          needsConfirmation: true,
          response: `Confirmation required. Reply: confirm ${cleanTranscript}`,
        }
      }
      const response = await updateLeadStatus(supabase, input.userId, lead.id, status)
      return { ok: true, transcript, response }
    }

    // ── Content ideas ─────────────────────────────────────────────────────
    case 'list_content_ideas': {
      const ideas = await loadRemoteContentIdeas(supabase, input.userId, activeClientId)
      return { ok: true, transcript, response: formatContentIdeasForChat(ideas) }
    }

    case 'content_idea_approve':
    case 'content_idea_reject':
    case 'content_idea_draft': {
      const action = vi.intent === 'content_idea_approve' ? 'approve'
        : vi.intent === 'content_idea_reject' ? 'reject' : 'draft'
      const index = vi.index
      if (!index) {
        return { ok: false, transcript, response: 'Which idea number? Say "approve idea 2" for example.' }
      }
      const ideas = await loadRemoteContentIdeas(supabase, input.userId, activeClientId)
      const idea = numberedItem(ideas, index)
      if (!idea) {
        return {
          ok: false,
          transcript,
          response: `I only found ${ideas.length} active content idea${ideas.length === 1 ? '' : 's'}. Reply "list content ideas" to see the current list.`,
        }
      }
      const response = await executeRemoteContentIdeaAction(supabase, {
        userId: input.userId,
        clientId: activeClientId,
        idea,
        index,
        action,
      })
      return { ok: true, transcript, response }
    }

    // ── Navigation / search / refresh ─────────────────────────────────────
    case 'navigate': {
      const view = vi.view || 'home'
      const tabHint = vi.tab ? ` → ${vi.tab}` : ''
      const viewDescriptions: Record<string, string> = {
        home: 'Home is your daily queue and command bar.',
        campaigns: 'Campaigns is your GTM orchestration layer — objectives, audiences, triggers, narratives, targets, content air cover, and outcomes.',
        accounts: 'Accounts shows your buying signals, hot fits, and watchlist.',
        outreach: 'Outreach is your pipeline — drafts, sent emails, and replies.',
        content: `Content is your publishing engine — the ${vi.tab || 'ideas'} tab has your post angles.`,
        agents: 'Agents shows your fleet status, activity, and workflows.',
        integrations: 'Integrations is where you connect social accounts, email, CRM, and Slack.',
        settings: 'Settings has your billing, profile, team, and automation config.',
      }
      const desc = viewDescriptions[view] || ''
      return {
        ok: true,
        transcript,
        response: tailorResponse(`${desc} Open the Bombsell dashboard → ${view}${tabHint} to see it.`, vi.sentiment),
      }
    }

    case 'search': {
      const query = vi.query || ''
      return {
        ok: true,
        transcript,
        response: query
          ? `Search is dashboard-only. Open Bombsell and search for "${query}".`
          : 'What would you like to search for?',
      }
    }

    case 'refresh':
      return { ok: true, transcript, response: 'Dashboard data will refresh the next time you open it.' }

    // ── Confirm / cancel ──────────────────────────────────────────────────
    case 'confirm':
      return { ok: false, transcript, response: 'Nothing to confirm right now.' }

    case 'cancel':
      return { ok: false, transcript, response: 'Nothing to cancel right now.' }

    // ── Help / unknown ────────────────────────────────────────────────────
    case 'help':
      return {
        ok: false,
        transcript,
        response: tailorResponse(
          'Here\'s what I can do from here:\n' +
          '📊 Pipeline: "show pipeline", "draft email for Acme", "send outreach to Stripe", "mark Tesla as booked"\n' +
          '🎯 Campaigns: "take me to campaigns", "where do I build a GTM motion"\n' +
          '💡 Content: "show content ideas", "approve idea 1", "draft idea 2", "go to composer"\n' +
          '🔍 Search: "do we have signals from Google", "find companies in fintech"\n' +
          '🧭 Navigate: "go to settings", "where are signals", "how to connect Gmail", "show content calendar"\n' +
          'You can also send voice notes instead of typing.',
          vi.sentiment,
        ),
      }

    default:
      return {
        ok: false,
        transcript,
        response: tailorResponse(vi.note || 'Try "show pipeline", "draft outreach for a company", or "approve idea 1".', vi.sentiment),
      }
  }
}

// ─── Lead resolution (by LLM-extracted name or index) ──────────────────────

async function resolveLeadByVoiceIntent(
  vi: { target?: string; index?: number },
  leads: Lead[],
  _supabase: ServiceSupabase,
  _userId: string,
): Promise<Lead | RemoteCommandResult> {
  void _supabase
  void _userId

  // Try by index first
  if (vi.index && vi.index > 0) {
    const ranked = rankRemotePipelineLeads(leads)
    const lead = numberedItem(ranked, vi.index)
    if (lead) return lead as Lead
  }

  // Try by name (fuzzy match)
  if (vi.target) {
    const target = vi.target.toLowerCase().trim()
    // Exact match
    const exact = leads.find(l => l.target_company.toLowerCase() === target)
    if (exact) return exact

    // Starts with
    const startsWith = leads.filter(l => l.target_company.toLowerCase().startsWith(target))
    if (startsWith.length === 1) return startsWith[0]
    if (startsWith.length > 1) {
      return {
        ok: false,
        transcript: '',
        response: `I found multiple companies starting with "${vi.target}": ${startsWith.map(l => l.target_company).join(', ')}. Which one?`,
      }
    }

    // Contains
    const contains = leads.filter(l => l.target_company.toLowerCase().includes(target))
    if (contains.length === 1) return contains[0]
    if (contains.length > 1) {
      return {
        ok: false,
        transcript: '',
        response: `I found multiple matches for "${vi.target}": ${contains.map(l => l.target_company).join(', ')}. Which one?`,
      }
    }
  }

  // Top lead fallback
  if (!vi.target && !vi.index) {
    const sorted = [...leads].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
    if (sorted.length > 0) return sorted[0]
  }

  return {
    ok: false,
    transcript: '',
    response: vi.target
      ? `Could not find "${vi.target}" in the current pipeline. Say "show pipeline" to see what's loaded.`
      : 'Which company should I use? Say the name or number from the pipeline.',
  }
}

// ─── Data loading ─────────────────────────────────────────────────────────

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

async function loadRemoteContentIdeas(
  supabase: ServiceSupabase,
  userId: string,
  clientId: string | null,
): Promise<RemoteContentIdea[]> {
  const workspaceId = clientId ?? userId
  const { data, error } = await supabase
    .from('content_ideas')
    .select('id, source, platform, angle, hook, rationale, score, status, created_at')
    .eq('workspace_id', workspaceId)
    .order('score', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return ((data ?? []) as RemoteContentIdea[])
    .filter(idea => !idea.status || idea.status === 'proposed' || idea.status === 'approved')
}

async function loadActiveClientId(supabase: ServiceSupabase, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('active_client_id')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as { active_client_id?: string | null } | null)?.active_client_id ?? null
}

// ─── Content idea actions ──────────────────────────────────────────────────

async function executeRemoteContentIdeaAction(
  supabase: ServiceSupabase,
  input: {
    userId: string
    clientId: string | null
    idea: RemoteContentIdea
    index: number
    action: 'approve' | 'reject' | 'draft'
  },
): Promise<string> {
  const workspaceId = input.clientId ?? input.userId
  if (input.action === 'approve' || input.action === 'reject') {
    const nextStatus = input.action === 'approve' ? 'approved' : 'rejected'
    const { error } = await supabase
      .from('content_ideas')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', input.idea.id)
      .eq('workspace_id', workspaceId)
    if (error) throw new Error(error.message)

    return `${nextStatus === 'approved' ? 'Approved' : 'Rejected'} idea ${input.index}: ${input.idea.angle}.`
  }

  const out = await dispatchTask(supabase, {
    userId: input.userId,
    clientId: input.clientId,
    role: 'writer',
    task: { tool: 'bombsell.content.write', arguments: { ideaId: input.idea.id, platform: input.idea.platform ?? undefined } },
    sessionId: 'remote-control-content-write',
  })
  if (out.status !== 'completed') throw new Error(out.error || 'Could not draft that content idea.')
  return `Drafted idea ${input.index}: ${input.idea.angle}. Reply "list content ideas" to keep working through the queue.`
}

// ─── Lead actions ─────────────────────────────────────────────────────────

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
  status: LeadStatusCommand,
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

// ─── Draft generation ─────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────

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

/**
 * Adapt a response message based on the user's detected sentiment.
 * Urgent responses are prefixed with acknowledgment, confused users
 * get extra guidance, frustrated users get empathy, curious users
 * get encouragement to explore.
 */
function tailorResponse(base: string, sentiment: VoiceSentiment): string {
  switch (sentiment) {
    case 'urgent':
      return 'Got it — ' + base.charAt(0).toLowerCase() + base.slice(1)
    case 'confused':
      return base + '\n\nNeed more help? Try saying "help" for a full list of what I can do, or ask me a specific question about your pipeline.'
    case 'frustrated':
      return 'I hear you. ' + base
    case 'curious':
      return base + '\n\nFeel free to explore — you can also try navigating to different views, searching for companies, or managing your content ideas.'
    default:
      return base
  }
}
