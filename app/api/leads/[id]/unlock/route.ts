import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPlanLimits, type PlanTier } from '@/lib/plan'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [leadRes, profileRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, is_unlocked')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('user_profiles')
      .select('plan')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (!leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  if (leadRes.data.is_unlocked) {
    return NextResponse.json({ ok: true, alreadyUnlocked: true })
  }

  const plan = (profileRes.data?.plan ?? 'free') as PlanTier
  if (plan === 'free') {
    const limit = getPlanLimits(plan).leads_per_month
    const { data: reserved, error } = await supabase.rpc('consume_lead_quota', {
      p_user_id: user.id,
      p_limit: limit,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!reserved) {
      return NextResponse.json(
        { error: `You’ve used all ${limit} free lead unlocks in your current 30-day window. Upgrade to unlock more.` },
        { status: 403 },
      )
    }
  }

  const unlockedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('leads')
    .update({ is_unlocked: true, unlocked_at: unlockedAt })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateError) {
    if (plan === 'free') {
      await supabase.rpc('refund_lead_quota', { p_user_id: user.id })
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, unlockedAt })
}
