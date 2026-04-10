import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { draftOutreachEmail } from '@/lib/claude'
import type { Stakeholder } from '../../../api/contacts/find/route'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId } = await request.json()
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

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
      .select('id, target_company, relevance_reason, signals (signal_type, summary, company_domain)')
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

  const lead = leadRes.data
  const profile = profileRes.data

  type SignalRow = { signal_type: string; summary: string; company_domain: string | null }
  const signalRaw = lead.signals as unknown as SignalRow | SignalRow[] | null
  const signal = Array.isArray(signalRaw) ? signalRaw[0] ?? null : signalRaw

  // Find stakeholder contacts in parallel with email drafting
  const contactsRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/contacts/find`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: request.headers.get('cookie') || '' },
    body: JSON.stringify({
      companyName: lead.target_company,
      companyDomain: signal?.company_domain,
    }),
  })

  const { stakeholders = [] }: { stakeholders: Stakeholder[] } = contactsRes.ok
    ? await contactsRes.json()
    : { stakeholders: [] }

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
