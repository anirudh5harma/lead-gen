import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { checkRateLimit } from '@/lib/rate-limit'
import { createCustomMarketingContentIdea, listMarketingContent, saveMarketingDraftPreference, scheduleMarketingContentIdea, updateMarketingContentIdea, type MarketingContentTab, type MarketingContentType } from '@/lib/gtm/content-workflow'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit') ?? 40)
  const refresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true'
  const tab = parseMarketingTab(url.searchParams.get('tab'))
  const timeZone = normalizeTimeZone(url.searchParams.get('tz'))
  const todayOnly = url.searchParams.get('today') !== '0'
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    if (refresh) {
      const rate = await checkRateLimit(`marketing:refresh:${user.id}:${activeClientId ?? 'workspace'}`, 8, 60 * 60, { supabase })
      if (!rate.allowed) return NextResponse.json({ error: 'Too many content refreshes. Try again later.' }, { status: 429 })
    }
    const result = await listMarketingContent(supabase, {
      userId: user.id,
      clientId: activeClientId,
      limit,
      refresh,
      tab,
      timeZone,
      todayOnly,
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
    raw_body?: unknown
    assets?: unknown
    scheduled_for?: unknown
    draft_settings?: unknown
    tab?: unknown
    time_zone?: unknown
  }
  const ideaId = typeof payload.idea_id === 'string' ? payload.idea_id.trim() : ''
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''
  if (!['draft', 'approve', 'dismiss', 'reject', 'create_custom', 'save_custom', 'schedule', 'update_draft_settings'].includes(action)) {
    return NextResponse.json({ error: 'valid action is required' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    if (action === 'update_draft_settings') {
      const tab = typeof payload.tab === 'string' ? parseMarketingTab(payload.tab) : null
      if (!tab) return NextResponse.json({ error: 'valid tab is required' }, { status: 400 })
      await saveMarketingDraftPreference(supabase, {
        userId: user.id,
        clientId: activeClientId,
        tab,
        settings: normalizeDraftSettingsPayload(payload.draft_settings) ?? {},
        timeZone: normalizeTimeZone(typeof payload.time_zone === 'string' ? payload.time_zone : null),
      })
      return NextResponse.json({ ok: true })
    }

    if (action === 'create_custom' || action === 'save_custom') {
      const rate = await checkRateLimit(`marketing:custom:${user.id}:${activeClientId ?? 'workspace'}`, 25, 60 * 60, { supabase })
      if (!rate.allowed) return NextResponse.json({ error: 'Too many custom content actions. Try again later.' }, { status: 429 })
      const contentType = typeof payload.content_type === 'string' && isMarketingContentType(payload.content_type)
        ? payload.content_type
        : null
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
      const rawBody = typeof payload.raw_body === 'string' ? payload.raw_body : ''
      const scheduledFor = parseOptionalIsoDate(payload.scheduled_for)
      if (scheduledFor === 'invalid') return NextResponse.json({ error: 'scheduled_for must be a valid date' }, { status: 400 })
      if (!contentType) return NextResponse.json({ error: 'content_type is required' }, { status: 400 })
      const idea_id = await createCustomMarketingContentIdea(supabase, {
        userId: user.id,
        clientId: activeClientId,
        contentType,
        prompt,
        rawBody,
        assets: normalizeAssets(payload.assets),
        draftSettings: normalizeDraftSettingsPayload(payload.draft_settings),
        scheduledFor,
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
        draftSettings: normalizeDraftSettingsPayload(payload.draft_settings),
      })
      return NextResponse.json({ ok: true })
    }

    if (!ideaId) return NextResponse.json({ error: 'idea_id is required' }, { status: 400 })
    if (action === 'draft') {
      const rate = await checkRateLimit(`marketing:draft:${user.id}:${activeClientId ?? 'workspace'}`, 40, 60 * 60, { supabase })
      if (!rate.allowed) return NextResponse.json({ error: 'Too many draft requests. Try again later.' }, { status: 429 })
    }
    await updateMarketingContentIdea(supabase, {
      userId: user.id,
      clientId: activeClientId,
      ideaId,
      action: (action === 'reject' ? 'dismiss' : action) as 'draft' | 'approve' | 'dismiss',
      draftSettings: normalizeDraftSettingsPayload(payload.draft_settings),
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

function parseMarketingTab(value: string | null): MarketingContentTab | null {
  if (value === 'posts' || value === 'blogs' || value === 'videos') return value
  return null
}

function normalizeTimeZone(value: string | null): string {
  if (!value) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return value
  } catch {
    return 'UTC'
  }
}

function normalizeDraftSettingsPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
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
    .slice(0, 10)
}

function parseOptionalIsoDate(value: unknown): string | null | 'invalid' {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'invalid'
  return date.toISOString()
}
