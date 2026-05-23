import type { SupabaseClient } from '@supabase/supabase-js'

export interface ActiveClientContext {
  activeClientId: string | null
}

export async function getActiveClientContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveClientContext> {
  const { data } = await supabase
    .from('user_profiles')
    .select('active_client_id')
    .eq('user_id', userId)
    .maybeSingle()

  return {
    activeClientId: (data as { active_client_id?: string | null } | null)?.active_client_id ?? null,
  }
}
