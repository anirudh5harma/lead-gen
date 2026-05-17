import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveCampaignTargetStatus, type CampaignLeadLike } from '@/lib/gtm/campaigns'

export async function updateCampaignTargetsForLead(
  supabase: SupabaseClient,
  input: {
    userId: string
    lead: CampaignLeadLike & { client_id?: string | null }
  },
): Promise<void> {
  const { data, error } = await supabase
    .from('gtm_campaign_targets')
    .select('id, campaign_id, lead_id, status')
    .eq('user_id', input.userId)
    .eq('lead_id', input.lead.id)

  if (error) {
    if (error.code === '42P01' || /does not exist/i.test(error.message ?? '')) return
    throw error
  }

  const targets = (data ?? []) as Array<{ id: string; campaign_id: string; lead_id: string; status: string | null }>
  await Promise.all(targets.map(target => {
    const nextStatus = deriveCampaignTargetStatus(input.lead, target.status)
    if (nextStatus === target.status) return Promise.resolve()
    return supabase
      .from('gtm_campaign_targets')
      .update({ status: nextStatus })
      .eq('id', target.id)
      .eq('user_id', input.userId)
  }))
}
