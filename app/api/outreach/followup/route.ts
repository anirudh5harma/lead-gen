import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { draftFollowUpEmail } from '@/lib/deepseek'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { getDefaultSequenceTemplate } from '@/lib/sequence-templates'

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
    .select('target_company, relevance_reason, client_id, feed_snapshot')
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

  const [{ data: clientProfile }, template] = await Promise.all([
    lead?.client_id
      ? supabase
          .from('client_accounts')
          .select('name, services_description')
          .eq('id', lead.client_id)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getDefaultSequenceTemplate(supabase, user.id, lead?.client_id ?? null),
  ])

  const signal = normalizeLeadFeedSnapshot((lead as { feed_snapshot?: unknown }).feed_snapshot ?? null)

  // Primary stakeholder name for personalisation
  const stakeholders = Array.isArray(originalDraft.stakeholders)
    ? originalDraft.stakeholders as Array<{ name?: string }>
    : []
  const primaryName = stakeholders[0]?.name || 'there'

  const { subject, body } = await draftFollowUpEmail({
    senderCompany:      (clientProfile as { name?: string } | null)?.name || profile?.company_name || 'us',
    servicesDescription: (clientProfile as { services_description?: string } | null)?.services_description || profile?.services_description || '',
    stakeholderName:    primaryName,
    targetCompany:      lead.target_company,
    signalType:         signal?.signal_type || 'event',
    signalSummary:      signal?.summary || lead.relevance_reason || '',
    originalSubject:    originalDraft.subject,
    originalBody:       originalDraft.body,
    customInstructions: template?.followup_custom_instructions ?? null,
  })

  const { data: saved, error: saveErr } = await supabase
    .from('outreach_sequences')
    .insert({ lead_id: leadId, client_id: lead.client_id ?? null, followup_subject: subject, followup_body: body })
    .select('id, followup_subject, followup_body')
    .single()

  if (saveErr) {
    // Return in-memory even if DB save fails
    return NextResponse.json({ followup_subject: subject, followup_body: body })
  }

  return NextResponse.json(saved)
}
