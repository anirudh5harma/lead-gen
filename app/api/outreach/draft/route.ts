import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { draftOutreachEmail } from '@/lib/claude'
import { checkRateLimit } from '@/lib/rate-limit'
import { enrichCompany } from '@/lib/email-finder/enrich'
import { scrapeSignalArticle } from '@/lib/email-finder/firecrawl'
import type { Stakeholder } from '../../../api/contacts/find/route'
import { getDefaultSequenceTemplate } from '@/lib/sequence-templates'

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

  const rl = await checkRateLimit(`draft:${user.id}`, 15, 3600)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many draft requests. Limit is 15 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
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

  // Fetch lead + signal, and user profile separately (no direct FK from leads → user_profiles)
  const [leadRes, profileRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, target_company, relevance_reason, contact_email, contact_name, contact_title, signals (signal_type, summary, company_domain, headline, funding_amount, published_at, source_url)')
      .eq('id', leadId)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('user_profiles')
      .select('company_name, services_description, calendly_url')
      .eq('user_id', user.id)
      .single(),
  ])

  if (leadRes.error || !leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  const lead = leadRes.data as typeof leadRes.data & {
    contact_email?: string | null
    contact_name?: string | null
    contact_title?: string | null
    client_id?: string | null
  }
  const profile = profileRes.data
  const clientId = lead.client_id ?? null

  const [{ data: clientProfile }, template] = await Promise.all([
    clientId
      ? supabase
          .from('client_accounts')
          .select('name, services_description, calendly_url')
          .eq('id', clientId)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getDefaultSequenceTemplate(supabase, user.id, clientId),
  ])

  type SignalRow = {
    signal_type: string; summary: string; company_domain: string | null
    headline: string | null; funding_amount: string | null
    published_at: string | null; source_url: string | null
  }
  const signalRaw = lead.signals as unknown as SignalRow | SignalRow[] | null
  const signal = Array.isArray(signalRaw) ? signalRaw[0] ?? null : signalRaw

  // Use pre-enriched contact if available; otherwise fall back to contacts/find
  let stakeholders: Stakeholder[] = []
  if (lead.contact_email && lead.contact_name) {
    stakeholders = [{
      name: lead.contact_name,
      title: lead.contact_title ?? 'Decision Maker',
      email: lead.contact_email,
    } as Stakeholder]
  } else {
    // On-demand enrichment: checks cache first, then Apollo → Hunter
    const serviceClient = await createServiceClient()
    const { contact, resolvedDomain } = await enrichCompany(
      lead.target_company,
      signal?.company_domain ?? null,
      serviceClient
    )

    if (contact) {
      // Backfill the lead so the next draft request uses the cached path
      const backfill: Record<string, unknown> = {
        contact_email:       contact.email.toLowerCase(),
        contact_name:        contact.name  || null,
        contact_title:       contact.title || null,
        contact_source:      contact.source,
        contact_verified:    contact.verified,
        contact_enriched_at: new Date().toISOString(),
      }
      if (resolvedDomain && !signal?.company_domain) backfill.company_domain = resolvedDomain
      await serviceClient.from('leads').update(backfill).eq('id', leadId)

      stakeholders = [{
        name:       contact.name,
        title:      contact.title || 'Decision Maker',
        email:      contact.email,
        confidence: contact.verified ? 'high' : 'medium',
        source:     contact.source,
      }]
    }
  }

  // Scrape article for personalization facts — race with a 5s timeout so it never blocks the draft
  const articleContext = signal?.source_url
    ? await Promise.race([
        scrapeSignalArticle(signal.source_url),
        new Promise<string>(resolve => setTimeout(() => resolve(''), 5000)),
      ])
    : ''

  const primaryStakeholder = stakeholders[0] || { name: 'the team', title: 'Leadership' }

  const { subject, body } = await draftOutreachEmail({
    senderCompany:       (clientProfile as { name?: string } | null)?.name || profile?.company_name || 'us',
    servicesDescription: (clientProfile as { services_description?: string } | null)?.services_description || profile?.services_description || '',
    stakeholderName:     primaryStakeholder.name,
    stakeholderTitle:    primaryStakeholder.title,
    targetCompany:       lead.target_company,
    signalType:          signal?.signal_type || 'event',
    signalSummary:       signal?.summary || lead.relevance_reason || '',
    headline:            signal?.headline ?? null,
    fundingAmount:       signal?.funding_amount ?? null,
    signalAgeLabel:      signalAgeLabel(signal?.published_at ?? null),
    articleContext:      articleContext || null,
    calendlyUrl:         (clientProfile as { calendly_url?: string | null } | null)?.calendly_url || (profile as { calendly_url?: string | null } | null)?.calendly_url || null,
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
