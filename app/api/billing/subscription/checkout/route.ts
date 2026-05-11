import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSubscriptionCheckoutUrl, getDodoConfigSummary } from '@/lib/dodo'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await checkRateLimit(`billing-sub:${user.id}`, 10, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many checkout attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const body = await request.json().catch(() => null) as {
    tier?: unknown
    period?: unknown
  } | null

  const tier = (['launch', 'team', 'growth', 'scale'] as const).includes(body?.tier as never)
    ? (body!.tier as 'launch' | 'team' | 'growth' | 'scale')
    : null
  const period = body?.period === 'annual' ? 'annual' : 'monthly'

  if (!tier) {
    return NextResponse.json({ error: 'Select a valid plan tier.' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_name')
    .eq('user_id', user.id)
    .maybeSingle()

  try {
    const url = await createSubscriptionCheckoutUrl({
      userEmail: user.email ?? '',
      userName: profile?.company_name ?? user.email ?? '',
      userId: user.id,
      tier,
      period,
    })
    return NextResponse.json({ url, tier, period })
  } catch (error) {
    const config = getDodoConfigSummary()
    console.error('[billing/subscription/checkout] dodo checkout error', {
      error: error instanceof Error ? error.message : String(error),
      userId: user.id,
      tier,
      period,
      environment: config.environment,
      hasApiKey: config.hasApiKey,
      hasGrowthMonthly: config.hasGrowthMonthly,
      hasScaleMonthly: config.hasScaleMonthly,
    })

    return NextResponse.json(
      { error: 'Unable to start subscription checkout right now.' },
      { status: 502 },
    )
  }
}
