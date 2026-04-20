import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutUrl, PRODUCT_IDS } from '@/lib/dodo'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const plan = (body as { plan?: string }).plan
  if (plan !== 'pro' && plan !== 'max') {
    return NextResponse.json({ error: 'plan must be "pro" or "max"' }, { status: 400 })
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

  const url = await createCheckoutUrl(
    user.email ?? '',
    profile?.company_name ?? user.email ?? '',
    productId,
    user.id,
  )

  return NextResponse.json({ url })
}
