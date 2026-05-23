import { NextResponse } from 'next/server'
import { draftOutreachEmail, repairOutreachBodyTriggerOpening } from '@/lib/deepseek'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { buildRecipientGroup, ensureBodyGreetsRecipients, mergeRecipientStakeholders } from '@/lib/outreach-recipients'
import { resolveOutreachContext } from '@/lib/outreach-context'
import { buildGtmContextPack } from '@/lib/gtm/semantic-context'
import { evaluateOutreachDraftQuality } from '@/lib/gtm/draft-eval'
import { upsertGtmEvalTrace } from '@/lib/gtm/eval-traces'
import { loadAccessibleLead } from '@/lib/lead-access'
import { firstUsableStakeholder, resolveLeadRecipients, upsertOutreachDraft } from '@/lib/outreach-workflow'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  contactTitleMatchesRoles,
  normalizeRoleSelection,
  type ContactRoleKey,
} from '@/lib/contact-targeting'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_DRAFT_CONTACTS = 3

type Stakeholder = { name: string; title: string; email: string; confidence: string; source: string }

function applyDraftContactLimit<T>(value: T[], maxContacts = MAX_DRAFT_CONTACTS): T[] {
  return value.slice(0, Math.max(1, maxContacts))
}

function normalizeStakeholders(
  stakeholders: Array<{ name?: string; title?: string; email?: string; confidence?: string; source?: string }>,
): Stakeholder[] {
  return stakeholders.map(stakeholder => ({
    name: stakeholder.name ?? '',
    title: stakeholder.title ?? '',
    email: stakeholder.email ?? '',
    confidence: stakeholder.confidence ?? 'medium',
    source: stakeholder.source ?? 'enrichment',
  }))
}

function filterStakeholdersByRoles(stakeholders: Stakeholder[], targetRoles: ContactRoleKey[]): Stakeholder[] {
  if (targetRoles.length === 0) return stakeholders
  const filtered = stakeholders.filter(stakeholder => contactTitleMatchesRoles(stakeholder.title, targetRoles))
  return filtered.length > 0 ? filtered : stakeholders
}

async function parseTargetRoles(request: Request): Promise<ContactRoleKey[]> {
  try {
    const payload = await request.json().catch(() => null) as { target_roles?: unknown } | null
    return normalizeRoleSelection(payload?.target_roles)
  } catch {
    return []
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const targetRoles = await parseTargetRoles(request)
  const { id } = await params
  const serviceSupabase = await createServiceClient()
  const { lead, error: leadError } = await loadAccessibleLead<{
    id: string
    user_id: string
    client_id: string | null
    target_company: string
    company_domain: string | null
    relevance_reason: string | null
    is_unlocked: boolean
    contact_email: string | null
    contact_name: string | null
    contact_title: string | null
    contact_verified: boolean | null
    feed_snapshot: unknown
  }>(serviceSupabase, {
    userId: user.id,
    leadId: id,
    select: 'id, user_id, client_id, target_company, company_domain, relevance_reason, is_unlocked, contact_email, contact_name, contact_title, contact_verified, feed_snapshot',
  })

  if (leadError) return NextResponse.json({ error: leadError }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const [existingDraftRes, profileRes, clientProfileRes] = await Promise.all([
    supabase
      .from('outreach_drafts')
      .select('subject, body, stakeholders')
      .eq('lead_id', id)
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, calendly_url')
      .eq('user_id', user.id)
      .maybeSingle(),
    lead.client_id
      ? serviceSupabase
          .from('client_accounts')
          .select('name, website_url, services_description, calendly_url')
          .eq('id', lead.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (existingDraftRes.error) return NextResponse.json({ error: existingDraftRes.error.message }, { status: 500 })
  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 })
  if (clientProfileRes.error) return NextResponse.json({ error: clientProfileRes.error.message }, { status: 500 })

  const signal = normalizeLeadFeedSnapshot(lead.feed_snapshot)
  const outreachContext = resolveOutreachContext({
    userProfile: profileRes.data,
    clientProfile: clientProfileRes.data,
  })
  const contactResolution = await resolveLeadRecipients(serviceSupabase, {
    lead,
    userId: user.id,
    servicesDescription: outreachContext.servicesDescription,
    signalType: signal?.signal_type ?? null,
    signalDomain: signal?.company_domain ?? null,
    consumeCreditIfLocked: true,
    creditSource: 'work_inbox_draft_unlock',
    refundCreditWhenNoContact: true,
    preferLeadContact: false,
    targetRoles,
    maxContacts: MAX_DRAFT_CONTACTS,
  })

  if (existingDraftRes.data?.subject && existingDraftRes.data?.body) {
    const existingStakeholders = normalizeStakeholders(
      Array.isArray(existingDraftRes.data.stakeholders)
        ? existingDraftRes.data.stakeholders as Array<{ name?: string; title?: string; email?: string; confidence?: string; source?: string }>
        : [],
    )
    const mergedStakeholders = normalizeStakeholders(
      mergeRecipientStakeholders(existingStakeholders, contactResolution.stakeholders),
    )
    const stakeholdersForDraft = existingStakeholders.length > 0
      ? mergedStakeholders
      : filterStakeholdersByRoles(mergedStakeholders, targetRoles)
    const stakeholders = applyDraftContactLimit(
      stakeholdersForDraft,
      MAX_DRAFT_CONTACTS,
    )
    const recipientGroup = buildRecipientGroup(stakeholders) ?? contactResolution.recipientGroup
    const existingRecipient = firstUsableStakeholder(stakeholders)
    const resolvedRecipient = recipientGroup?.to ?? contactResolution.recipientGroup?.to ?? null
    const greeting = recipientGroup?.greeting || contactResolution.recipientGroup?.greeting || 'Hi there'
    const repairedBody = ensureBodyGreetsRecipients(
      repairOutreachBodyTriggerOpening(existingDraftRes.data.body, {
        firstName: greeting,
        recipientGreeting: greeting,
        targetCompany: lead.target_company as string,
      }),
      greeting,
    )
    const draftEval = evaluateOutreachDraftQuality({
      subject: existingDraftRes.data.subject,
      body: repairedBody,
      greeting,
      targetCompany: lead.target_company as string,
      signalType: signal?.signal_type ?? null,
      signalSummary: signal?.summary ?? (lead.relevance_reason as string | null) ?? null,
    })
    await upsertOutreachDraft(serviceSupabase, {
      leadId: id,
      userId: user.id,
      clientId: (lead.client_id as string | null | undefined) ?? null,
      subject: existingDraftRes.data.subject,
      body: repairedBody,
      stakeholders,
      greeting,
      qualityScore: draftEval.score,
      qualityChecks: draftEval.checks,
      qualityCheckedAt: new Date().toISOString(),
      qualityVersion: draftEval.version,
    }).catch(error => console.error('[lead-draft] failed to repair existing draft:', error))
    await upsertGtmEvalTrace(serviceSupabase, {
      userId: user.id,
      clientId: (lead.client_id as string | null | undefined) ?? null,
      leadId: id,
      traceType: 'draft_quality',
      status: draftEval.score >= 70 ? 'passed' : 'warning',
      reasons: draftEval.failed,
      draftQualityScore: draftEval.score,
      metadata: {
        quality_version: draftEval.version,
        contact_resolution: contactResolution.debug,
        target_roles: targetRoles,
      },
    })
    const fallbackRecipients = resolvedRecipient
      ? [resolvedRecipient]
      : existingRecipient
        ? [existingRecipient]
        : []
    const recipientGroupAll = stakeholders.length > 0 ? stakeholders : fallbackRecipients
    const ccRecipients = recipientGroupAll.slice(1)

    return NextResponse.json({
      draft: {
        subject: existingDraftRes.data.subject,
        body: repairedBody,
        to: resolvedRecipient?.email ?? existingRecipient?.email ?? null,
        to_name: resolvedRecipient?.name ?? existingRecipient?.name ?? null,
        cc: ccRecipients.map((r: Partial<{ name: string; email: string }>) => ({ name: r.name ?? '', email: r.email ?? '' })),
        all: recipientGroupAll.map((r: Partial<{ name: string; title: string; email: string; confidence: string; source: string }>) => ({
          name: r.name ?? '',
          title: r.title ?? '',
          email: r.email ?? '',
          confidence: r.confidence ?? '',
          source: r.source ?? '',
        })),
        contact_resolution: {
          ...contactResolution.debug,
          target_roles: targetRoles,
        },
        quality_eval: draftEval,
      },
    })
  }

  const contextPack = await buildGtmContextPack(supabase, {
    userId: user.id,
    clientId: (lead.client_id as string | null | undefined) ?? null,
    leadId: id,
    query: [
      lead.target_company,
      signal?.headline,
      signal?.summary,
      lead.relevance_reason,
    ].filter(value => typeof value === 'string' && value.trim()).join('\n'),
    limit: 8,
  })

  const stakeholders = contactResolution.stakeholders.length > 0
    ? applyDraftContactLimit(
        filterStakeholdersByRoles(normalizeStakeholders(contactResolution.stakeholders), targetRoles),
        MAX_DRAFT_CONTACTS,
      )
    : contactResolution.recipientGroup
      ? [{
          name: contactResolution.recipientGroup.to.name,
          title: contactResolution.recipientGroup.to.title,
          email: contactResolution.recipientGroup.to.email,
          confidence: 'high',
          source: 'work_inbox',
        }]
      : []
  const recipientGroup = buildRecipientGroup(stakeholders) ?? contactResolution.recipientGroup

  const { subject, body } = await draftOutreachEmail({
    senderCompany: outreachContext.senderCompany,
    senderWebsiteUrl: outreachContext.websiteUrl,
    servicesDescription: outreachContext.servicesDescription,
    stakeholderName: recipientGroup?.to.name || 'there',
    stakeholderTitle: recipientGroup?.titleSummary || 'leadership team',
    recipientGreeting: recipientGroup?.greeting || 'Hi there',
    targetCompany: lead.target_company as string,
    signalType: signal?.signal_type || 'event',
    signalSummary: signal?.summary || (lead.relevance_reason as string | null) || '',
    headline: signal?.headline ?? null,
    fundingAmount: signal?.funding_amount ?? null,
    signalAgeLabel: null,
    articleContext: contextPack.drafting_context || null,
    calendlyUrl: outreachContext.calendlyUrl,
    customInstructions: null,
  })
  const normalizedBody = ensureBodyGreetsRecipients(body, recipientGroup?.greeting || 'Hi there')
  const draftEval = evaluateOutreachDraftQuality({
    subject,
    body: normalizedBody,
    greeting: recipientGroup?.greeting || 'Hi there',
    targetCompany: lead.target_company as string,
    signalType: signal?.signal_type ?? null,
    signalSummary: signal?.summary ?? (lead.relevance_reason as string | null) ?? null,
  })

  try {
    await upsertOutreachDraft(serviceSupabase, {
      leadId: id,
      userId: user.id,
      clientId: (lead.client_id as string | null | undefined) ?? null,
      subject,
      body: normalizedBody,
      stakeholders,
      greeting: recipientGroup?.greeting || 'Hi there',
      qualityScore: draftEval.score,
      qualityChecks: draftEval.checks,
      qualityCheckedAt: new Date().toISOString(),
      qualityVersion: draftEval.version,
    })
    await upsertGtmEvalTrace(serviceSupabase, {
      userId: user.id,
      clientId: (lead.client_id as string | null | undefined) ?? null,
      leadId: id,
      traceType: 'draft_quality',
      status: draftEval.score >= 70 ? 'passed' : 'warning',
      reasons: draftEval.failed,
      draftQualityScore: draftEval.score,
      metadata: {
        quality_version: draftEval.version,
        contact_resolution: contactResolution.debug,
        target_roles: targetRoles,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save draft' }, { status: 500 })
  }

  const allRecipients = stakeholders.length > 0 ? stakeholders : (recipientGroup ? [recipientGroup.to] : [])
  const ccRecipients = allRecipients.slice(1)

  return NextResponse.json({
    draft: {
      subject,
      body: normalizedBody,
      to: recipientGroup?.to.email ?? null,
      to_name: recipientGroup?.to.name ?? null,
      cc: ccRecipients.map((r: Partial<{ name: string; email: string }>) => ({ name: r.name ?? '', email: r.email ?? '' })),
      all: allRecipients.map((r: Partial<{ name: string; title: string; email: string; confidence: string; source: string }>) => ({
        name: r.name ?? '',
        title: r.title ?? '',
        email: r.email ?? '',
        confidence: r.confidence ?? '',
        source: r.source ?? '',
      })),
      contact_resolution: {
        ...contactResolution.debug,
        target_roles: targetRoles,
      },
      quality_eval: draftEval,
    },
  })
}
