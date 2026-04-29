import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { draftOutreachEmail } from '@/lib/deepseek'
import { checkRateLimit } from '@/lib/rate-limit'
import { enrichCompany } from '@/lib/email-finder/enrich'
import { scrapeSignalArticle } from '@/lib/email-finder/firecrawl'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import type { Stakeholder } from '../../../api/contacts/find/route'
import { getDefaultSequenceTemplate } from '@/lib/sequence-templates'
import { resolveOutreachContext } from '@/lib/outreach-context'

function signalAgeLabel(publishedAt: string | null): string | null {
  if (!publishedAt) return null
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000
  if (ageHours < 24)  return 'this morning'
  if (ageHours < 48)  return 'yesterday'
  if (ageHours < 96)  return '2 days ago'
  if (ageHours < 168) return 'earlier this week'
  return 'last week'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId } = await request.json()
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  // Fetch lead + signal, and user profile separately (no direct FK from leads → user_profiles)
  const [leadRes, profileRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, client_id, is_unlocked, target_company, company_domain, relevance_reason, contact_email, contact_name, contact_title, contact_verified, feed_snapshot')
      .eq('id', leadId)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('user_profiles')
      .select('company_name, website_url, services_description, calendly_url')
      .eq('user_id', user.id)
      .single(),
  ])

  if (leadRes.error || !leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  if (!leadRes.data.is_unlocked) {
    return NextResponse.json({ error: 'Unlock this lead first to generate contacts and outreach.' }, { status: 403 })
  }

  // Check if draft already exists
  const { data: existingDraft } = await supabase
    .from('outreach_drafts')
    .select('id, subject, body, stakeholders')
    .eq('lead_id', leadId)
    .single()

  if (existingDraft) {
    return NextResponse.json(existingDraft)
  }

  const rl = await checkRateLimit(`draft:${user.id}`, 15, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many draft requests. Limit is 15 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  const lead = leadRes.data as typeof leadRes.data & {
    contact_email?: string | null
    contact_name?: string | null
    contact_title?: string | null
    contact_verified?: boolean | null
    client_id?: string | null
  }
  const profile = profileRes.data
  const clientId = lead.client_id ?? null

  const [{ data: clientProfile }, template] = await Promise.all([
    clientId
      ? supabase
          .from('client_accounts')
          .select('name, website_url, services_description, calendly_url')
          .eq('id', clientId)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getDefaultSequenceTemplate(supabase, user.id, clientId),
  ])

  const signal = normalizeLeadFeedSnapshot((lead as { feed_snapshot?: unknown }).feed_snapshot ?? null)

  // Use the cached multi-contact enrichment path so the drawer can show 3-4 ranked contacts.
  let stakeholders: Stakeholder[] = []
  const serviceClient = await createServiceClient()
  const { contact, contacts, resolvedDomain } = await enrichCompany(
    lead.target_company,
    signal?.company_domain ?? lead.company_domain ?? null,
    serviceClient,
    {
      servicesDescription: outreachContextDescription(profile, clientProfile),
      signalType: signal?.signal_type ?? null,
      maxContacts: 4,
    },
  )

  const verifiedContacts = contacts.filter(item => item.verified)
  if (verifiedContacts.length > 0) {
    stakeholders = verifiedContacts.map(item => ({
      name: item.name,
      title: item.title || 'Decision Maker',
      email: item.email,
      confidence: 'high',
      source: item.source,
    }))
  } else if (lead.contact_email && lead.contact_name && lead.contact_verified === true) {
    stakeholders = [{
      name: lead.contact_name,
      title: lead.contact_title ?? 'Decision Maker',
      email: lead.contact_email,
      confidence: 'high',
      source: 'hunter',
    }]
  }

  if (contact) {
    const backfill: Record<string, unknown> = {
      contact_email:       contact.email.toLowerCase(),
      contact_name:        contact.name || null,
      contact_title:       contact.title || null,
      contact_source:      contact.source,
      contact_verified:    contact.verified,
      contact_enriched_at: new Date().toISOString(),
    }
    if (resolvedDomain && !signal?.company_domain && !lead.company_domain) backfill.company_domain = resolvedDomain
    await serviceClient.from('leads').update(backfill).eq('id', leadId)
  }

  // Scrape article for personalization facts — race with a 5s timeout so it never blocks the draft
  const articleContext = signal?.source_url
    ? await Promise.race([
        scrapeSignalArticle(signal.source_url),
        new Promise<string>(resolve => setTimeout(() => resolve(''), 5000)),
      ])
    : ''

  const primaryStakeholder = stakeholders[0] || { name: 'the team', title: 'Leadership' }
  const outreachContext = resolveOutreachContext({
    userProfile: profile,
    clientProfile: clientProfile,
  })

  const { subject, body } = await draftOutreachEmail({
    senderCompany:       outreachContext.senderCompany,
    senderWebsiteUrl:    outreachContext.websiteUrl,
    servicesDescription: outreachContext.servicesDescription,
    stakeholderName:     primaryStakeholder.name,
    stakeholderTitle:    primaryStakeholder.title,
    targetCompany:       lead.target_company,
    signalType:          signal?.signal_type || 'event',
    signalSummary:       signal?.summary || lead.relevance_reason || '',
    headline:            signal?.headline ?? null,
    fundingAmount:       signal?.funding_amount ?? null,
    signalAgeLabel:      signalAgeLabel(signal?.published_at ?? null),
    articleContext:      articleContext || null,
    calendlyUrl:         outreachContext.calendlyUrl,
    customInstructions:  template?.custom_instructions ?? null,
  })

  // Save draft to DB
  const { data: draft, error: saveErr } = await supabase
    .from('outreach_drafts')
    .insert({
      lead_id: leadId,
      client_id: clientId,
      subject,
      body,
      stakeholders,
    })
    .select('id, subject, body, stakeholders')
    .single()

  if (saveErr) {
    console.error('Draft save error:', saveErr)
    // Return in-memory draft even if save fails
    return NextResponse.json({ subject, body, stakeholders })
  }

  return NextResponse.json(draft)
}

function outreachContextDescription(
  profile: { services_description?: string | null } | null,
  clientProfile: { services_description?: string | null } | null,
): string {
  return clientProfile?.services_description || profile?.services_description || ''
}
