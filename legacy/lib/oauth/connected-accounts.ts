import type { SupabaseClient } from '@supabase/supabase-js'
import { getTierConfig, type SubscriptionTier } from '@/lib/lead-credits'

export const MAX_CONNECTED_SENDING_ACCOUNTS = 5

export function getMaxInboxesForTier(tier: SubscriptionTier): number {
  return getTierConfig(tier).maxInboxes
}

export async function getUserTier(supabase: SupabaseClient, userId: string): Promise<SubscriptionTier> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.plan as SubscriptionTier) || 'free'
}

export async function canConnectSendingAccount(
  supabase: SupabaseClient,
  userId: string,
  provider: 'gmail' | 'outlook',
  email: string,
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase()

  const { data: existingAccount, error: existingError } = await supabase
    .from('connected_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .ilike('email', normalizedEmail)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message)
  if (existingAccount) return true

  const tier = await getUserTier(supabase, userId)
  const maxInboxes = getMaxInboxesForTier(tier)

  const { count, error: countError } = await supabase
    .from('connected_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)

  if (countError) throw new Error(countError.message)
  return (count ?? 0) < maxInboxes
}
