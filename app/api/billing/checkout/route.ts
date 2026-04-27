import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutUrl, getDodoConfigSummary, PRODUCT_IDS } from '@/lib/dodo'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const plan = (body as { plan?: string }).plan
  if (plan !== 'pro') {
    return NextResponse.json({ error: 'plan must be "pro"' }, { status: 400 })
  }

  const productId = PRODUCT_IDS[plan]
  if (!productId) {
    return NextResponse.json({ error: `DODO_PRODUCT_${plan.toUpperCase()} env var not set` }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_name')
    .eq('user_id', user.id)
    .maybeSingle()

  try {
    const url = await createCheckoutUrl(
      user.email ?? '',
      profile?.company_name ?? user.email ?? '',
      productId,
      user.id,
    )

    return NextResponse.json({ url })
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : null
    const config = getDodoConfigSummary()

    console.error('[billing/checkout] dodo checkout error', {
      status,
      plan,
      userId: user.id,
      environment: config.environment,
      hasApiKey: config.hasApiKey,
      hasProProduct: config.hasProProduct,
      hasLeadCreditsProduct: config.hasLeadCreditsProduct,
      hasBusinessId: config.hasBusinessId,
    })

    if (status === 401) {
      return NextResponse.json(
        { error: 'Billing is misconfigured. Dodo API credentials or mode do not match the configured products.' },
        { status: 503 },
      )
    }

    return NextResponse.json(
      { error: 'Unable to start checkout right now. Please try again shortly.' },
      { status: 502 },
    )
  }
}
