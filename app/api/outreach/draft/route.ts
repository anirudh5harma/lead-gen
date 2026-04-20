import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { draftOutreachEmail } from '@/lib/claude'
import { checkRateLimit } from '@/lib/rate-limit'
import { enrichCompany } from '@/lib/email-finder/enrich'
import type { Stakeholder } from '../../../api/contacts/find/route'

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
      .select('id, target_company, relevance_reason, contact_email, contact_name, contact_title, signals (signal_type, summary, company_domain)')
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
  }
  const profile = profileRes.data

  type SignalRow = { signal_type: string; summary: string; company_domain: string | null }
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

  // Draft email targeting the top stakeholder (or a generic title if none found)
  const primaryStakeholder = stakeholders[0] || {
    name: 'the team',
    title: 'Leadership',
  }

  const { subject, body } = await draftOutreachEmail({
    senderCompany: profile?.company_name || 'us',
    servicesDescription: profile?.services_description || '',
    stakeholderName: primaryStakeholder.name,
    stakeholderTitle: primaryStakeholder.title,
    targetCompany: lead.target_company,
    signalType: signal?.signal_type || 'event',
    signalSummary: signal?.summary || lead.relevance_reason || '',
    calendlyUrl: (profile as { calendly_url?: string | null } | null)?.calendly_url || null,
  })

  // Save draft to DB
  const { data: draft, error: saveErr } = await supabase
    .from('outreach_drafts')
    .insert({
      lead_id: leadId,
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
