import { NextResponse } from 'next/server'
import { draftOutreachEmail, repairOutreachBodyTriggerOpening } from '@/lib/deepseek'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { buildRecipientGroup, ensureBodyGreetsRecipients, mergeRecipientStakeholders } from '@/lib/outreach-recipients'
import { resolveOutreachContext } from '@/lib/outreach-context'
import { buildGtmContextPack } from '@/lib/gtm/semantic-context'
import { firstUsableStakeholder, resolveLeadRecipients, upsertOutreachDraft } from '@/lib/outreach-workflow'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, user_id, client_id, target_company, company_domain, relevance_reason, is_unlocked, contact_email, contact_name, contact_title, contact_verified, feed_snapshot')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 })
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
      ? supabase
          .from('client_accounts')
          .select('name, website_url, services_description, calendly_url')
          .eq('id', lead.client_id)
          .eq('user_id', user.id)
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
  const serviceSupabase = await createServiceClient()
  const contactResolution = await resolveLeadRecipients(serviceSupabase, {
    lead,
    userId: user.id,
    servicesDescription: outreachContext.servicesDescription,
    signalType: signal?.signal_type ?? null,
    signalDomain: signal?.company_domain ?? null,
    consumeCreditIfLocked: true,
    creditSource: 'work_inbox_draft_unlock',
    refundCreditWhenNoContact: true,
    maxContacts: 4,
  })

  if (existingDraftRes.data?.subject && existingDraftRes.data?.body) {
    const stakeholders = mergeRecipientStakeholders(existingDraftRes.data.stakeholders, contactResolution.stakeholders)
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
    if (repairedBody !== existingDraftRes.data.body || stakeholders.length > 0) {
      await upsertOutreachDraft(serviceSupabase, {
        leadId: id,
        userId: user.id,
        clientId: (lead.client_id as string | null | undefined) ?? null,
        subject: existingDraftRes.data.subject,
        body: repairedBody,
        stakeholders,
        greeting,
      }).catch(error => console.error('[lead-draft] failed to repair existing draft:', error))
    }
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
      contact_resolution: contactResolution.debug,
    },
  })
  }

  const recipientGroup = contactResolution.recipientGroup
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
  const stakeholders = contactResolution.stakeholders.length > 0
    ? contactResolution.stakeholders
    : recipientGroup
      ? [{
          name: recipientGroup.to.name,
          title: recipientGroup.to.title,
          email: recipientGroup.to.email,
          confidence: 'high',
          source: 'work_inbox',
        }]
      : []

  try {
    await upsertOutreachDraft(serviceSupabase, {
      leadId: id,
      userId: user.id,
      clientId: (lead.client_id as string | null | undefined) ?? null,
      subject,
      body: normalizedBody,
      stakeholders,
      greeting: recipientGroup?.greeting || 'Hi there',
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save draft' }, { status: 500 })
  }

  const allRecipientsNew = stakeholders.length > 0 ? stakeholders : (recipientGroup ? [recipientGroup.to] : [])
  const ccRecipientsNew = allRecipientsNew.slice(1)

  return NextResponse.json({
    draft: {
      subject,
      body: normalizedBody,
      to: recipientGroup?.to.email ?? null,
      to_name: recipientGroup?.to.name ?? null,
      cc: ccRecipientsNew.map((r: Partial<{ name: string; email: string }>) => ({ name: r.name ?? '', email: r.email ?? '' })),
      all: allRecipientsNew.map((r: Partial<{ name: string; title: string; email: string; confidence: string; source: string }>) => ({
        name: r.name ?? '',
        title: r.title ?? '',
        email: r.email ?? '',
        confidence: r.confidence ?? '',
        source: r.source ?? '',
      })),
      contact_resolution: contactResolution.debug,
    },
  })
}
