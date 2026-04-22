import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { emitCrmLeadEvent } from '@/lib/crm-sync'

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

  const { data: lead, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
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

  return NextResponse.json({ ok: true })
}
