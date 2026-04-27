import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeLeadCreditsForDollars, normalizeCreditTopUpAmount } from '@/lib/lead-credits'
import { createLeadCreditCheckoutUrl, getDodoConfigSummary } from '@/lib/dodo'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { amount_dollars?: unknown } | null
  const amountDollars = normalizeCreditTopUpAmount(body?.amount_dollars)
  if (!amountDollars) {
    return NextResponse.json({ error: 'Choose a valid top-up amount.' }, { status: 400 })
  }

  const credits = computeLeadCreditsForDollars(amountDollars)
  if (credits <= 0) {
    return NextResponse.json({ error: 'Credit conversion is not configured correctly.' }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_name')
    .eq('user_id', user.id)
    .maybeSingle()

  try {
    const url = await createLeadCreditCheckoutUrl({
      userEmail: user.email ?? '',
      userName: profile?.company_name ?? user.email ?? '',
      userId: user.id,
      amountDollars,
      credits,
    })
    return NextResponse.json({ url, amount_dollars: amountDollars, credits })
  } catch (error) {
    const config = getDodoConfigSummary()
    console.error('[billing/credits/checkout] dodo checkout error', {
      error: error instanceof Error ? error.message : String(error),
      userId: user.id,
      amountDollars,
      credits,
      environment: config.environment,
      hasApiKey: config.hasApiKey,
      hasLeadCreditsProduct: config.hasLeadCreditsProduct,
    })

    return NextResponse.json(
      { error: 'Unable to start credit checkout right now.' },
      { status: 502 },
    )
  }
}
