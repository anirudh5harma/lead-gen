import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { SubscriptionTier } from './lead-credits'
import { hasPlanAccess } from './plan-access'

export async function requirePlan(
  supabase: SupabaseClient,
  requiredTier: SubscriptionTier,
): Promise<{ userId: string; tier: SubscriptionTier } | NextResponse> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle()

  const tier = (data?.plan as SubscriptionTier) || 'free'

  if (!hasPlanAccess(tier, requiredTier)) {
    return NextResponse.json(
      { error: `This feature requires the ${requiredTier} plan.` },
      { status: 403 },
    )
  }

  return { userId: user.id, tier }
}
