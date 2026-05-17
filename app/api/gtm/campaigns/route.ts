import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'
import { requirePlan } from '@/lib/api-plan-guard'
import { checkRateLimit } from '@/lib/rate-limit'
import { buildCampaignMetrics, buildCampaignReadiness, summarizeCampaignCounts } from '@/lib/gtm/campaigns'

export const dynamic = 'force-dynamic'

type OptionalSupabaseRows<T> = { data: T[] | null; error: { code?: string; message?: string } | null }

function optionalRows<T>(result: OptionalSupabaseRows<T>): T[] {
  if (!result.error) return result.data ?? []
  if (result.error.code === '42P01' || /does not exist/i.test(result.error.message ?? '')) return []
  throw result.error
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck

  const { activeClientId } = await getActiveClientContext(supabase, userId)

  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const requestedStatus = request.nextUrl.searchParams.get('status')
  const limit = boundedNumber(request.nextUrl.searchParams.get('limit'), 1, 100, 50)
  let campaignsQuery = supabase
    .from('gtm_campaigns')
    .select('id, name, objective, segment, trigger, narrative, offer, success_metric, channels, status, starts_at, ends_at, learnings, created_at, updated_at')
    .eq('user_id', userId)
    .match(clientFilter)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (requestedStatus && ['draft', 'active', 'paused', 'completed', 'dismissed'].includes(requestedStatus)) {
    campaignsQuery = campaignsQuery.eq('status', requestedStatus)
  }

  const [campaignsRes, assetsRes, targetsRes, linksRes] = await Promise.all([
    campaignsQuery,
    supabase
      .from('gtm_campaign_assets')
      .select('campaign_id, status')
      .eq('user_id', userId)
      .match(clientFilter),
    supabase
      .from('gtm_campaign_targets')
      .select('campaign_id, status')
      .eq('user_id', userId)
      .match(clientFilter),
    supabase
      .from('gtm_campaign_content_links')
      .select('campaign_id, status, channel')
      .eq('user_id', userId)
      .match(clientFilter),
  ])

  if (campaignsRes.error) {
    return NextResponse.json({ error: campaignsRes.error.message }, { status: 500 })
  }
  if (assetsRes.error) {
    return NextResponse.json({ error: assetsRes.error.message }, { status: 500 })
  }

  const campaigns = (campaignsRes.data ?? [])
  const assets = (assetsRes.data ?? []) as Array<{ campaign_id: string; status: string }>
  const targets = optionalRows(targetsRes) as Array<{ campaign_id: string; status: string }>
  const links = optionalRows(linksRes) as Array<{ campaign_id: string; status: string; channel?: string | null }>
  const campaignsWithCounts = summarizeCampaignCounts(campaigns, { targets, links, assets }).map(campaign => ({
    ...campaign,
    readiness: buildCampaignReadiness({
      campaign,
      targetCount: campaign.target_counts.total,
      contentCount: campaign.content_counts.total,
      approvedAssetCount: campaign.asset_counts.approved + campaign.asset_counts.published,
    }),
  }))
  const metrics = buildCampaignMetrics(campaigns, { targets, links, assets })

  return NextResponse.json({ campaigns: campaignsWithCounts, metrics })
}

function boundedNumber(value: string | null, min: number, max: number, fallback: number): number {
  const parsed = value ? Number(value) : fallback
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck
  const rate = await checkRateLimit(`marketing:campaign:create:${userId}`, 30, 60 * 60, { failClosed: true })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many campaign creates. Try again later.' }, { status: 429 })

  const body = await request.json().catch(() => null) as {
    name?: string
    segment?: string
    trigger?: string
    narrative?: string
    objective?: string
    offer?: string
    success_metric?: string
    channels?: string[]
    content_idea_ids?: string[]
  } | null

  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, userId)

  const segment = body.segment?.trim() ?? 'All accounts'
  const trigger = body.trigger?.trim() ?? 'Market timing signal'
  const narrative = body.narrative?.trim() ?? 'Signal-backed outreach leveraging recent market movement'
  const channels = Array.isArray(body.channels) && body.channels.length
    ? Array.from(new Set(body.channels.filter(channel => typeof channel === 'string' && channel.trim()).map(channel => channel.trim()))).slice(0, 6)
    : ['email', 'linkedin', 'content']

  const { data: campaign, error } = await supabase
    .from('gtm_campaigns')
    .insert({
      user_id: userId,
      client_id: activeClientId,
      name: body.name.trim(),
      objective: body.objective?.trim() || body.name.trim(),
      segment,
      trigger,
      narrative,
      offer: body.offer?.trim() || null,
      success_metric: body.success_metric?.trim() || 'Meetings booked from this motion',
      channels,
      status: 'draft',
    })
    .select('id, name, objective, segment, trigger, narrative, offer, success_metric, channels, status, starts_at, ends_at, learnings, created_at, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (body.content_idea_ids?.length) {
    const { data: ideas } = await supabase
      .from('gtm_content_ideas')
      .select('id, content_type, angle')
      .eq('user_id', userId)
      .in('id', body.content_idea_ids)

    const assetRows = (ideas ?? []).map(idea => ({
      campaign_id: campaign.id,
      user_id: userId,
      client_id: activeClientId,
      content_idea_id: idea.id,
      asset_type: idea.content_type,
      title: idea.angle.slice(0, 200),
      body: idea.angle,
      channel: idea.content_type === 'linkedin_post' ? 'linkedin' : 'email',
      status: 'draft',
    }))

    if (assetRows.length > 0) {
      await supabase.from('gtm_campaign_assets').insert(assetRows)
    }
  }

  return NextResponse.json({ campaign })
}
