import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { sanitizeSessionIds } from '@/lib/auto-send-policies'
import { requirePlan } from '@/lib/api-plan-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const userId = planCheck.userId

  const { id: sessionId } = await params
  const body = await request.json().catch(() => null) as { action?: 'add' | 'remove' } | null
  const action = body?.action

  if (action !== 'add' && action !== 'remove') {
    return NextResponse.json({ error: 'action must be "add" or "remove"' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const runQuery = activeClientId
    ? supabase
        .from('explore_runs')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('client_id', activeClientId)
        .maybeSingle()
    : supabase
        .from('explore_runs')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .is('client_id', null)
        .maybeSingle()
  const { data: existingRun, error: runError } = await runQuery
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 })
  if (!existingRun) return NextResponse.json({ error: 'Session not found for active workspace.' }, { status: 404 })

  const existingQuery = activeClientId
    ? supabase
        .from('auto_send_policies')
        .select('id, enabled, target_explore_session_ids, target_origins')
        .eq('user_id', userId)
        .eq('client_id', activeClientId)
        .maybeSingle()
    : supabase
        .from('auto_send_policies')
        .select('id, enabled, target_explore_session_ids, target_origins')
        .eq('user_id', userId)
        .is('client_id', null)
        .maybeSingle()

  const { data: existing, error: existingError } = await existingQuery
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  const currentlyEnabled = (existing as { enabled?: boolean | null } | null)?.enabled === true

  const currentSessionIds = sanitizeSessionIds((existing as { target_explore_session_ids?: unknown })?.target_explore_session_ids)
  const currentOrigins = Array.isArray((existing as { target_origins?: unknown })?.target_origins)
    ? (existing as { target_origins: string[] }).target_origins
    : []

  let newSessionIds: string[]
  let newOrigins: string[]

  if (action === 'add') {
    if (currentSessionIds.includes(sessionId)) {
      return NextResponse.json({ ok: true, message: 'Session already in autopilot.' })
    }
    newSessionIds = [...currentSessionIds, sessionId].slice(0, 25)
    newOrigins = currentOrigins.includes('explore') ? currentOrigins : [...currentOrigins, 'explore']
  } else {
    newSessionIds = currentSessionIds.filter(id => id !== sessionId)
    newOrigins = newSessionIds.length > 0 ? currentOrigins : currentOrigins.filter(o => o !== 'explore')
  }

  const policyPayload = {
    target_explore_session_ids: newSessionIds,
    target_origins: newOrigins,
    enabled: action === 'add'
      ? true
      : (newOrigins.length > 0 ? currentlyEnabled : false),
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('auto_send_policies')
      .update(policyPayload)
      .eq('id', (existing as { id: string }).id)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  } else {
    const { error: insertError } = await supabase
      .from('auto_send_policies')
      .insert({
        user_id: userId,
        client_id: activeClientId,
        ...policyPayload,
        require_verified_contact: true,
        min_relevance_score: 7,
        max_lead_age_days: 30,
        daily_send_limit: 10,
        explore_daily_send_limit: 3,
        min_minutes_between_sends: 15,
      })
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const runStatus = action === 'add' ? 'queued' : (newSessionIds.length > 0 ? 'sending' : 'paused')
  const { error: runUpdateError } = await supabase
    .from('explore_runs')
    .update({
      autopilot_status: runStatus,
      autopilot_added_at: action === 'add' ? new Date().toISOString() : undefined,
      autopilot_removed_at: action === 'remove' ? new Date().toISOString() : undefined,
    })
    .eq('id', sessionId)
    .eq('user_id', userId)

  if (runUpdateError) console.error('[explore-autopilot] run status update failed:', runUpdateError.message)

  return NextResponse.json({
    ok: true,
    action,
    session_id: sessionId,
    target_explore_session_ids: newSessionIds,
  })
}
