import type { SupabaseClient } from '@supabase/supabase-js'

export const MAX_CONNECTED_SENDING_ACCOUNTS = 5

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

  const { count, error: countError } = await supabase
    .from('connected_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)

  if (countError) throw new Error(countError.message)
  return (count ?? 0) < MAX_CONNECTED_SENDING_ACCOUNTS
}
