import type { SupabaseClient } from '@supabase/supabase-js'

type LeadAccessRow = {
  user_id?: string | null
  client_id?: string | null
}

export async function userCanAccessLead(
  supabase: SupabaseClient,
  userId: string,
  lead: LeadAccessRow | null,
): Promise<boolean> {
  if (!lead) return false
  if (lead.user_id === userId) return true
  if (!lead.client_id) return false

  const [{ data: owned }, { data: member }] = await Promise.all([
    supabase
      .from('client_accounts')
      .select('id')
      .eq('id', lead.client_id)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('workspace_members')
      .select('id')
      .eq('client_id', lead.client_id)
      .eq('user_id', userId)
      .not('accepted_at', 'is', null)
      .maybeSingle(),
  ])

  return Boolean(owned || member)
}

export async function loadAccessibleLead<T extends LeadAccessRow>(
  supabase: SupabaseClient,
  params: {
    userId: string
    leadId: string
    select: string
  },
): Promise<{ lead: T | null; error: string | null }> {
  const { data, error } = await supabase
    .from('leads')
    .select(params.select)
    .eq('id', params.leadId)
    .maybeSingle()

  if (error) return { lead: null, error: error.message }

  const lead = data as T | null
  const allowed = await userCanAccessLead(supabase, params.userId, lead)
  return { lead: allowed ? lead : null, error: null }
}
