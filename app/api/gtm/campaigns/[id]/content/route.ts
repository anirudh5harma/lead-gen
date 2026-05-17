import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'
import { requirePlan } from '@/lib/api-plan-guard'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

type ContentKind = 'content_idea' | 'post' | 'gtm_content_idea' | 'gtm_campaign_asset'

const KIND_TO_COLUMN: Record<ContentKind, string> = {
  content_idea: 'content_idea_id',
  post: 'post_id',
  gtm_content_idea: 'gtm_content_idea_id',
  gtm_campaign_asset: 'gtm_campaign_asset_id',
}

const KIND_TO_TABLE: Record<ContentKind, string> = {
  content_idea: 'content_ideas',
  post: 'posts',
  gtm_content_idea: 'gtm_content_ideas',
  gtm_campaign_asset: 'gtm_campaign_assets',
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck
  const rate = await checkRateLimit(`marketing:campaign:content:${userId}`, 120, 60 * 60, { failClosed: true })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many campaign content updates. Try again later.' }, { status: 429 })

  const { id } = await params
  const body = await request.json().catch(() => null) as { kind?: string; id?: string; channel?: string; status?: string; rationale?: string } | null
  if (!body?.id || !body.kind || !(body.kind in KIND_TO_COLUMN)) {
    return NextResponse.json({ error: 'kind and id are required' }, { status: 400 })
  }
  const kind = body.kind as ContentKind
  const column = KIND_TO_COLUMN[kind]
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

  let contentQuery = supabase.from(KIND_TO_TABLE[kind]).select('id').eq('id', body.id)
  if (kind === 'content_idea' || kind === 'post') {
    contentQuery = contentQuery.eq('workspace_id', activeClientId ?? userId)
  } else {
    contentQuery = contentQuery.eq('user_id', userId).match(clientFilter)
  }
  const { data: content, error: contentError } = await contentQuery.maybeSingle()
  if (contentError) return NextResponse.json({ error: contentError.message }, { status: 500 })
  if (!content) return NextResponse.json({ error: 'Content not found for this workspace' }, { status: 404 })

  const row = {
    campaign_id: id,
    user_id: userId,
    client_id: activeClientId,
    [column]: body.id,
    channel: body.channel?.trim() || 'linkedin',
    status: isContentStatus(body.status) ? body.status : 'linked',
    rationale: body.rationale?.trim() || null,
  }

  const select = 'id, campaign_id, content_idea_id, post_id, gtm_content_idea_id, gtm_campaign_asset_id, channel, status, rationale, created_at'
  const { data: existing, error: existingError } = await supabase
    .from('gtm_campaign_content_links')
    .select('id')
    .eq('campaign_id', id)
    .eq(column, body.id)
    .eq('user_id', userId)
    .match(clientFilter)
    .maybeSingle()

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })

  const query = existing
    ? supabase.from('gtm_campaign_content_links').update(row).eq('id', existing.id).select(select).single()
    : supabase.from('gtm_campaign_content_links').insert(row).select(select).single()

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'launch')
  if (planCheck instanceof NextResponse) return planCheck
  const { userId } = planCheck
  const { id } = await params
  const url = new URL(request.url)
  const linkId = url.searchParams.get('link_id')
  if (!linkId) return NextResponse.json({ error: 'link_id is required' }, { status: 400 })
  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const { error } = await supabase
    .from('gtm_campaign_content_links')
    .delete()
    .eq('id', linkId)
    .eq('campaign_id', id)
    .eq('user_id', userId)
    .match(clientFilter)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function isContentStatus(value: unknown): value is 'linked' | 'drafted' | 'approved' | 'scheduled' | 'published' | 'dismissed' {
  return typeof value === 'string' && ['linked', 'drafted', 'approved', 'scheduled', 'published', 'dismissed'].includes(value)
}
