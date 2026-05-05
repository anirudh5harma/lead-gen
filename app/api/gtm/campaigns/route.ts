import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const [campaignsRes, ideasRes] = await Promise.all([
    supabase
      .from('gtm_campaigns')
      .select('id, name, segment, trigger, narrative, status, created_at, updated_at')
      .eq('user_id', user.id)
      .match(clientFilter)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('gtm_campaign_assets')
      .select('campaign_id, status')
      .eq('user_id', user.id)
      .match(clientFilter),
  ])

  if (campaignsRes.error) {
    return NextResponse.json({ error: campaignsRes.error.message }, { status: 500 })
  }

  const campaigns = (campaignsRes.data ?? [])
  const assets = (ideasRes.data ?? []) as Array<{ campaign_id: string; status: string }>

  const campaignsWithCounts = campaigns.map(c => {
    const campaignAssets = assets.filter(a => a.campaign_id === c.id)
    return {
      ...c,
      asset_counts: {
        total: campaignAssets.length,
        draft: campaignAssets.filter(a => a.status === 'draft').length,
        approved: campaignAssets.filter(a => a.status === 'approved').length,
        published: campaignAssets.filter(a => a.status === 'published').length,
      },
    }
  })

  const metrics = {
    total: campaigns.length,
    draft: campaigns.filter(c => c.status === 'draft').length,
    active: campaigns.filter(c => c.status === 'active').length,
    completed: campaigns.filter(c => c.status === 'completed').length,
    assets: assets.length,
  }

  return NextResponse.json({ campaigns: campaignsWithCounts, metrics })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    name?: string
    segment?: string
    trigger?: string
    narrative?: string
    content_idea_ids?: string[]
  } | null

  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const segment = body.segment?.trim() ?? 'All accounts'
  const trigger = body.trigger?.trim() ?? 'Market timing signal'
  const narrative = body.narrative?.trim() ?? 'Signal-backed outreach leveraging recent market movement'

  const { data: campaign, error } = await supabase
    .from('gtm_campaigns')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      name: body.name.trim(),
      segment,
      trigger,
      narrative,
      status: 'active',
    })
    .select('id, name, segment, trigger, narrative, status, created_at, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (body.content_idea_ids?.length) {
    const { data: ideas } = await supabase
      .from('gtm_content_ideas')
      .select('id, content_type, angle')
      .eq('user_id', user.id)
      .in('id', body.content_idea_ids)

    const assetRows = (ideas ?? []).map(idea => ({
      campaign_id: campaign.id,
      user_id: user.id,
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
