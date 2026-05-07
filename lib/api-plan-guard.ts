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

export async function requireWorkspacePlan(
  supabase: SupabaseClient,
  params: {
    userId: string
    clientId: string
    requiredTier: SubscriptionTier
  },
): Promise<{ billingUserId: string; tier: SubscriptionTier } | NextResponse> {
  const { userId, clientId, requiredTier } = params

  const [{ data: client }, { data: membership }] = await Promise.all([
    supabase
      .from('client_accounts')
      .select('id, user_id, billing_user_id')
      .eq('id', clientId)
      .maybeSingle(),
    supabase
      .from('workspace_members')
      .select('id')
      .eq('client_id', clientId)
      .eq('user_id', userId)
      .not('accepted_at', 'is', null)
      .maybeSingle(),
  ])

  if (!client || (client.user_id !== userId && !membership)) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const billingUserId = (client.billing_user_id as string | null | undefined) ?? client.user_id
  const { data: ownerProfile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', billingUserId)
    .maybeSingle()

  const tier = (ownerProfile?.plan as SubscriptionTier) || 'free'
  if (!hasPlanAccess(tier, requiredTier)) {
    return NextResponse.json(
      { error: `This workspace requires the ${requiredTier} plan.` },
      { status: 403 },
    )
  }

  return { billingUserId, tier }
}
