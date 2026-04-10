import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { draftFollowUpEmail } from '@/lib/claude'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId } = await request.json() as { leadId?: string }
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  // Return cached follow-up if it exists
  const { data: existing } = await supabase
    .from('outreach_sequences')
    .select('id, followup_subject, followup_body')
    .eq('lead_id', leadId)
    .single()

  if (existing) return NextResponse.json(existing)

  // Need the original draft to reference
  const { data: originalDraft } = await supabase
    .from('outreach_drafts')
    .select('subject, body, stakeholders')
    .eq('lead_id', leadId)
    .single()

  if (!originalDraft) {
    return NextResponse.json(
      { error: 'Draft the initial email first before generating a follow-up.' },
      { status: 404 }
    )
  }

  // Lead + signal
  const { data: lead } = await supabase
    .from('leads')
    .select('target_company, relevance_reason, signals(signal_type, summary)')
    .eq('id', leadId)
    .eq('user_id', user.id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // User profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_name, services_description')
    .eq('user_id', user.id)
    .single()

  type SignalRow = { signal_type: string; summary: string }
  const signalRaw = lead.signals as unknown as SignalRow | SignalRow[] | null
  const signal = Array.isArray(signalRaw) ? signalRaw[0] ?? null : signalRaw

  // Primary stakeholder name for personalisation
  const stakeholders = Array.isArray(originalDraft.stakeholders)
    ? originalDraft.stakeholders as Array<{ name?: string }>
    : []
  const primaryName = stakeholders[0]?.name || 'there'

  const { subject, body } = await draftFollowUpEmail({
    senderCompany:      profile?.company_name || 'us',
    servicesDescription: profile?.services_description || '',
    stakeholderName:    primaryName,
    targetCompany:      lead.target_company,
    signalType:         signal?.signal_type || 'event',
    signalSummary:      signal?.summary || lead.relevance_reason || '',
    originalSubject:    originalDraft.subject,
    originalBody:       originalDraft.body,
  })

  const { data: saved, error: saveErr } = await supabase
    .from('outreach_sequences')
    .insert({ lead_id: leadId, followup_subject: subject, followup_body: body })
    .select('id, followup_subject, followup_body')
    .single()

  if (saveErr) {
    // Return in-memory even if DB save fails
    return NextResponse.json({ followup_subject: subject, followup_body: body })
  }

  return NextResponse.json(saved)
}
