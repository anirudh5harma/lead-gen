import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { emitCrmLeadEvent } from '@/lib/crm-sync'
import { recordOutcomeLearning, type GtmOutcome } from '@/lib/gtm/outcome-learning'
import { loadAccessibleLead } from '@/lib/lead-access'

const VALID_STATUSES = ['new', 'viewed', 'drafted', 'sent', 'replied', 'booked', 'dismissed'] as const
type LeadStatus = typeof VALID_STATUSES[number]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { status } = await request.json() as { status?: string }

  if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { status }
  const s = status as LeadStatus
  if (s === 'sent')    updates.sent_at    = new Date().toISOString()
  if (s === 'replied') updates.replied_at = new Date().toISOString()
  if (s === 'booked')  updates.booked_at  = new Date().toISOString()

  const serviceSupabase = await createServiceClient()
  const access = await loadAccessibleLead<{
    id: string
    user_id: string
    client_id: string | null
    target_company: string
  }>(serviceSupabase, {
    userId: user.id,
    leadId: id,
    select: 'id, user_id, client_id, target_company',
  })
  if (access.error) return NextResponse.json({ error: access.error }, { status: 500 })
  if (!access.lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const { data: lead, error } = await serviceSupabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select('id, client_id, target_company, status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const eventType = status === 'replied'
    ? 'lead.replied'
    : status === 'booked'
      ? 'lead.booked'
      : 'lead.updated'

  emitCrmLeadEvent({
    userId: user.id,
    clientId: (lead as { client_id?: string | null } | null)?.client_id ?? null,
    eventType,
    payload: {
      lead_id: id,
      target_company: (lead as { target_company?: string } | null)?.target_company ?? '',
      status,
    },
  }).catch(() => {})

  const learningOutcome = statusToLearningOutcome(s)
  if (learningOutcome) {
    recordOutcomeLearning(serviceSupabase, {
      userId: user.id,
      clientId: (lead as { client_id?: string | null } | null)?.client_id ?? null,
      leadId: id,
      outcome: learningOutcome,
      observedAt: new Date().toISOString(),
      metadata: { source: 'lead_status_update' },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

function statusToLearningOutcome(status: LeadStatus): GtmOutcome | null {
  if (status === 'sent') return 'sent'
  if (status === 'replied') return 'replied'
  if (status === 'booked') return 'booked'
  if (status === 'dismissed') return 'dismissed'
  return null
}
