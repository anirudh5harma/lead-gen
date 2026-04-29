import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const rl = await checkRateLimit(`unlock:${user.id}`, 120, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many unlock attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const leadRes = await supabase
    .from('leads')
    .select('id, is_unlocked')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  if (leadRes.data.is_unlocked) {
    return NextResponse.json({ ok: true, alreadyUnlocked: true })
  }

  let usedCredit = false
  try {
    usedCredit = await consumeLeadCredit(supabase, {
      userId: user.id,
      leadId: id,
      metadata: { source: 'manual_unlock' },
    })
  } catch (creditError) {
    return NextResponse.json(
      { error: creditError instanceof Error ? creditError.message : 'Unable to use lead credit.' },
      { status: 500 },
    )
  }

  if (!usedCredit) {
    return NextResponse.json(
      { error: 'You need lead credits to unlock this lead. Add credits to continue.' },
      { status: 403 },
    )
  }

  const unlockedAt = new Date().toISOString()
  const { data: unlockedLead, error: updateError } = await supabase
    .from('leads')
    .update({ is_unlocked: true, unlocked_at: unlockedAt })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('is_unlocked', false)
    .select('id')
    .maybeSingle()

  if (updateError) {
    await refundLeadCredit(supabase, {
      userId: user.id,
      leadId: id,
      metadata: { source: 'manual_unlock_update_failed' },
    }).catch(() => {})
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (!unlockedLead) {
    await refundLeadCredit(supabase, {
      userId: user.id,
      leadId: id,
      metadata: { source: 'manual_unlock_race_refund' },
    }).catch(() => {})
    return NextResponse.json({ ok: true, alreadyUnlocked: true })
  }

  return NextResponse.json({ ok: true, unlockedAt, usedCredit })
}
