import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_STATUSES = ['new', 'viewed', 'drafted', 'sent', 'replied', 'booked', 'dismissed'] as const
type LeadStatus = typeof VALID_STATUSES[number]

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    lead_ids?: unknown
    action?: 'status' | 'delete'
    status?: string
  } | null

  const leadIds = Array.isArray(body?.lead_ids)
    ? body.lead_ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one lead.' }, { status: 400 })
  }

  if (body?.action === 'delete') {
    const { error, count } = await supabase
      .from('leads')
      .delete({ count: 'exact' })
      .eq('user_id', user.id)
      .in('id', leadIds)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: count ?? leadIds.length })
  }

  if (body?.action !== 'status' || !body.status || !(VALID_STATUSES as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: 'Provide a valid bulk action.' }, { status: 400 })
  }

  const status = body.status as LeadStatus
  const updates: Record<string, unknown> = { status }
  const now = new Date().toISOString()
  if (status === 'sent') updates.sent_at = now
  if (status === 'replied') updates.replied_at = now
  if (status === 'booked') updates.booked_at = now

  const { error, count } = await supabase
    .from('leads')
    .update(updates, { count: 'exact' })
    .eq('user_id', user.id)
    .in('id', leadIds)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, updated: count ?? leadIds.length, status })
}
