import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { requirePlan } from '@/lib/api-plan-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const userId = planCheck.userId

  const { id: sessionId } = await params
  const { activeClientId } = await getActiveClientContext(supabase, userId)

  let query = supabase
    .from('leads')
    .select(
      'id, client_id, origin, source_kind, source_record_id, feed_session_id, feed_session_label, feed_session_started_at, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, unlocked_at, created_at, sent_at, replied_at, booked_at, reply_intent, reply_summary, reply_body_snippet, reply_received_at, meeting_detected_at, booking_reply_sent_at, contact_email, contact_name, contact_title, feed_snapshot'
    )
    .eq('user_id', userId)
    .eq('feed_session_id', sessionId)
    .eq('origin', 'explore')
    .order('created_at', { ascending: false })

  if (activeClientId) {
    query = query.eq('client_id', activeClientId)
  } else {
    query = query.is('client_id', null)
  }

  const { data: leads, error } = await query

  if (error) {
    console.error('[explore-session-leads] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ leads: leads ?? [] })
}
