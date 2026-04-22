import type { SupabaseClient } from '@supabase/supabase-js'

export interface SequenceTemplate {
  id: string
  user_id: string
  client_id: string | null
  name: string
  custom_instructions: string | null
  followup_custom_instructions: string | null
  is_default: boolean
}

export async function getDefaultSequenceTemplate(
  supabase: SupabaseClient,
  userId: string,
  clientId?: string | null,
): Promise<SequenceTemplate | null> {
  let query = supabase
    .from('sequence_templates')
    .select('id, user_id, client_id, name, custom_instructions, followup_custom_instructions, is_default')
    .eq('user_id', userId)
    .eq('is_default', true)
    .limit(1)

  if (clientId) query = query.eq('client_id', clientId)
  else query = query.is('client_id', null)

  const { data } = await query.maybeSingle()
  return (data as SequenceTemplate | null) ?? null
}
