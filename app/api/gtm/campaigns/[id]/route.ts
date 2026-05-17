import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'
import { requirePlan } from '@/lib/api-plan-guard'
import { checkRateLimit } from '@/lib/rate-limit'
import { buildCampaignReadiness, syncCampaignTargetsWithLeads } from '@/lib/gtm/campaigns'

export const dynamic = 'force-dynamic'

type OptionalSupabaseRows<T> = { data: T[] | null; error: { code?: string; message?: string } | null }

function optionalRows<T>(result: OptionalSupabaseRows<T>): T[] {
  if (!result.error) return result.data ?? []
  if (result.error.code === '42P01' || /does not exist/i.test(result.error.message ?? '')) return []
  throw result.error
}

const CAMPAIGN_SELECT = 'id, name, objective, segment, trigger, narrative, offer, success_metric, channels, status, starts_at, ends_at, learnings, created_at, updated_at'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck
  const { id } = await params
  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const { data: campaign, error: campaignError } = await supabase
    .from('gtm_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('id', id)
    .eq('user_id', userId)
    .match(clientFilter)
    .single()
  if (campaignError || !campaign) return NextResponse.json({ error: campaignError?.message ?? 'Campaign not found' }, { status: 404 })

  const [targetsRes, linksRes, assetsRes] = await Promise.all([
    supabase
      .from('gtm_campaign_targets')
      .select('id, campaign_id, lead_id, status, rationale, created_at, lead:leads(id, target_company, company_domain, relevance_score, relevance_reason, status, sent_at, replied_at, booked_at, contact_email, contact_name, contact_title, created_at)')
      .eq('campaign_id', id)
      .eq('user_id', userId)
      .match(clientFilter)
      .order('created_at', { ascending: false }),
    supabase
      .from('gtm_campaign_content_links')
      .select('id, campaign_id, content_idea_id, post_id, gtm_content_idea_id, gtm_campaign_asset_id, channel, status, rationale, created_at')
      .eq('campaign_id', id)
      .eq('user_id', userId)
      .match(clientFilter)
      .order('created_at', { ascending: false }),
    supabase
      .from('gtm_campaign_assets')
      .select('id, campaign_id, content_idea_id, asset_type, title, body, channel, status, created_at')
      .eq('campaign_id', id)
      .eq('user_id', userId)
      .match(clientFilter)
      .order('created_at', { ascending: false }),
  ])

  let targets = optionalRows(targetsRes) as Array<{ id: string; campaign_id: string; lead_id: string; status: string; lead?: unknown }>
  const links = optionalRows(linksRes)
  const assets = assetsRes.error ? [] : (assetsRes.data ?? [])

  const targetLeads = targets
    .map(target => target.lead)
    .filter((lead): lead is { id: string; target_company: string; status?: string | null; sent_at?: string | null; replied_at?: string | null; booked_at?: string | null } => typeof lead === 'object' && lead !== null && 'id' in lead)
  const targetUpdates = syncCampaignTargetsWithLeads(targets, targetLeads)
  if (targetUpdates.length) {
    await Promise.all(targetUpdates.map(update => supabase
      .from('gtm_campaign_targets')
      .update({ status: update.status })
      .eq('campaign_id', update.campaign_id)
      .eq('lead_id', update.lead_id)
      .eq('user_id', userId)))
    targets = targets.map(target => {
      const update = targetUpdates.find(item => item.campaign_id === target.campaign_id && item.lead_id === target.lead_id)
      return update ? { ...target, status: update.status } : target
    })
  }

  const readiness = buildCampaignReadiness({
    campaign,
    targetCount: targets.length,
    contentCount: links.length,
    approvedAssetCount: assets.filter(asset => ['approved', 'published'].includes(String((asset as { status?: unknown }).status ?? ''))).length,
  })

  return NextResponse.json({ campaign: { ...campaign, readiness }, targets, content_links: links, assets })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck
  const rate = await checkRateLimit(`marketing:campaign:update:${userId}`, 60, 60 * 60, { failClosed: true })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many campaign updates. Try again later.' }, { status: 429 })

  const { id } = await params
  const body = await request.json().catch(() => null) as {
    action?: string
    name?: string
    objective?: string
    segment?: string
    trigger?: string
    narrative?: string
    offer?: string | null
    success_metric?: string | null
    channels?: string[]
    learnings?: Record<string, unknown>
  } | null

  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const update: Record<string, unknown> = {}
  if (body?.action === 'activate' || body?.action === 'pause' || body?.action === 'complete' || body?.action === 'dismiss') {
    const statusMap: Record<string, string> = { activate: 'active', pause: 'paused', complete: 'completed', dismiss: 'dismissed' }
    update.status = statusMap[body.action]
  }
  for (const key of ['name', 'objective', 'segment', 'trigger', 'narrative', 'offer', 'success_metric'] as const) {
    if (body && key in body) {
      const value = body[key]
      update[key] = typeof value === 'string' ? value.trim() : value ?? null
    }
  }
  if (Array.isArray(body?.channels)) {
    update.channels = Array.from(new Set(body.channels.filter(channel => typeof channel === 'string' && channel.trim()).map(channel => channel.trim()))).slice(0, 6)
  }
  if (body?.learnings && typeof body.learnings === 'object') update.learnings = body.learnings

  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No campaign updates provided' }, { status: 400 })

  if (body?.action === 'activate') {
    const [campaignRes, targetsRes, linksRes, assetsRes] = await Promise.all([
      supabase
        .from('gtm_campaigns')
        .select(CAMPAIGN_SELECT)
        .eq('id', id)
        .eq('user_id', userId)
        .match(clientFilter)
        .single(),
      supabase
        .from('gtm_campaign_targets')
        .select('id')
        .eq('campaign_id', id)
        .eq('user_id', userId)
        .match(clientFilter),
      supabase
        .from('gtm_campaign_content_links')
        .select('id')
        .eq('campaign_id', id)
        .eq('user_id', userId)
        .match(clientFilter),
      supabase
        .from('gtm_campaign_assets')
        .select('id, status')
        .eq('campaign_id', id)
        .eq('user_id', userId)
        .match(clientFilter),
    ])
    if (campaignRes.error || !campaignRes.data) return NextResponse.json({ error: campaignRes.error?.message ?? 'Campaign not found' }, { status: 404 })
    const targets = optionalRows(targetsRes)
    const links = optionalRows(linksRes)
    const assets = assetsRes.error ? [] : (assetsRes.data ?? [])
    const readiness = buildCampaignReadiness({
      campaign: { ...campaignRes.data, ...update, status: campaignRes.data.status },
      targetCount: targets.length,
      contentCount: links.length,
      approvedAssetCount: assets.filter(asset => ['approved', 'published'].includes(String((asset as { status?: unknown }).status ?? ''))).length,
    })
    if (!readiness.canLaunch) return NextResponse.json({ error: `Campaign is not launch-ready: ${readiness.nextAction}`, readiness }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('gtm_campaigns')
    .update(update)
    .eq('id', id)
    .eq('user_id', userId)
    .match(clientFilter)
    .select(CAMPAIGN_SELECT)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign: data })
}
