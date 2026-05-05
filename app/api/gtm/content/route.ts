import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createCustomMarketingContentIdea, listMarketingContent, scheduleMarketingContentIdea, updateMarketingContentIdea, type MarketingContentType } from '@/lib/gtm/content-workflow'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit') ?? 40)
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    const result = await listMarketingContent(supabase, {
      userId: user.id,
      clientId: activeClientId,
      limit,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load marketing content' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = body as {
    idea_id?: unknown
    action?: unknown
    content_type?: unknown
    prompt?: unknown
    assets?: unknown
    scheduled_for?: unknown
  }
  const ideaId = typeof payload.idea_id === 'string' ? payload.idea_id.trim() : ''
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''
  if (!['draft', 'approve', 'dismiss', 'create_custom', 'schedule'].includes(action)) {
    return NextResponse.json({ error: 'valid action is required' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    if (action === 'create_custom') {
      const contentType = typeof payload.content_type === 'string' && isMarketingContentType(payload.content_type)
        ? payload.content_type
        : null
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
      if (!contentType) return NextResponse.json({ error: 'content_type is required' }, { status: 400 })
      const idea_id = await createCustomMarketingContentIdea(supabase, {
        userId: user.id,
        clientId: activeClientId,
        contentType,
        prompt,
        assets: normalizeAssets(payload.assets),
      })
      return NextResponse.json({ ok: true, idea_id })
    }

    if (action === 'schedule') {
      if (!ideaId) return NextResponse.json({ error: 'idea_id is required' }, { status: 400 })
      const scheduledFor = parseOptionalIsoDate(payload.scheduled_for)
      if (scheduledFor === 'invalid') return NextResponse.json({ error: 'scheduled_for must be a valid date' }, { status: 400 })
      await scheduleMarketingContentIdea(supabase, {
        userId: user.id,
        clientId: activeClientId,
        ideaId,
        scheduledFor,
      })
      return NextResponse.json({ ok: true })
    }

    if (!ideaId) return NextResponse.json({ error: 'idea_id is required' }, { status: 400 })
    await updateMarketingContentIdea(supabase, {
      userId: user.id,
      clientId: activeClientId,
      ideaId,
      action: action as 'draft' | 'approve' | 'dismiss',
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update content idea' },
      { status: 500 },
    )
  }
}

function isMarketingContentType(value: string): value is MarketingContentType {
  return ['x_post', 'linkedin_post', 'blog_article', 'video_script', 'newsletter_blurb', 'campaign_brief', 'sales_enablement_note'].includes(value)
}

function normalizeAssets(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (typeof item === 'string') return { label: 'Asset', value: item }
      if (typeof item !== 'object' || item === null) return null
      const label = (item as { label?: unknown }).label
      const assetValue = (item as { value?: unknown }).value
      if (typeof assetValue !== 'string') return null
      return {
        label: typeof label === 'string' ? label : 'Asset',
        value: assetValue,
      }
    })
    .filter((item): item is { label: string; value: string } => Boolean(item?.value.trim()))
    .slice(0, 6)
}

function parseOptionalIsoDate(value: unknown): string | null | 'invalid' {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'invalid'
  return date.toISOString()
}
