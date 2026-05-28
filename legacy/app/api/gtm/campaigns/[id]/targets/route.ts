import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'
import { requirePlan } from '@/lib/api-plan-guard'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck
  const rate = await checkRateLimit(`marketing:campaign:targets:${userId}`, 120, 60 * 60, { failClosed: true })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many campaign target updates. Try again later.' }, { status: 429 })

  const { id } = await params
  const body = await request.json().catch(() => null) as { lead_ids?: string[]; status?: string } | null
  const leadIds = Array.from(new Set((body?.lead_ids ?? []).filter((leadId): leadId is string => typeof leadId === 'string' && leadId.trim().length > 0)))
  if (leadIds.length === 0) return NextResponse.json({ error: 'At least one lead id is required' }, { status: 400 })

  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const { data: campaign, error: campaignError } = await supabase
    .from('gtm_campaigns')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .match(clientFilter)
    .single()
  if (campaignError || !campaign) return NextResponse.json({ error: campaignError?.message ?? 'Campaign not found' }, { status: 404 })

  let leadsQuery = supabase
    .from('leads')
    .select('id')
    .eq('user_id', userId)
    .in('id', leadIds)
  if (activeClientId) leadsQuery = leadsQuery.eq('client_id', activeClientId)
  const { data: leads, error: leadsError } = await leadsQuery
  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })

  const allowedLeadIds = new Set((leads ?? []).map(lead => lead.id as string))
  const rows = leadIds
    .filter(leadId => allowedLeadIds.has(leadId))
    .map(leadId => ({
      campaign_id: id,
      user_id: userId,
      client_id: activeClientId,
      lead_id: leadId,
      status: body?.status === 'proposed' ? 'proposed' : 'enrolled',
    }))

  if (rows.length === 0) return NextResponse.json({ error: 'No matching leads found for this workspace' }, { status: 404 })

  const { data, error } = await supabase
    .from('gtm_campaign_targets')
    .upsert(rows, { onConflict: 'campaign_id,lead_id' })
    .select('id, campaign_id, lead_id, status, created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ targets: data ?? [], count: rows.length })
}
