import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { listMarketingContent, updateMarketingContentIdea } from '@/lib/gtm/content-workflow'
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

  const payload = body as { idea_id?: unknown; action?: unknown }
  const ideaId = typeof payload.idea_id === 'string' ? payload.idea_id.trim() : ''
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''
  if (!ideaId || !['draft', 'approve', 'dismiss'].includes(action)) {
    return NextResponse.json({ error: 'idea_id and valid action are required' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
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
