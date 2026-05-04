import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { listGtmInsights, updateGtmInsight } from '@/lib/gtm/insights'
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
    const result = await listGtmInsights(supabase, {
      userId: user.id,
      clientId: activeClientId,
      limit,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load insights' },
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

  const payload = body as { insight_id?: unknown; action?: unknown }
  const insightId = typeof payload.insight_id === 'string' ? payload.insight_id.trim() : ''
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''
  if (!insightId || !['action', 'dismiss'].includes(action)) {
    return NextResponse.json({ error: 'insight_id and valid action are required' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    await updateGtmInsight(supabase, {
      userId: user.id,
      clientId: activeClientId,
      insightId,
      action: action as 'action' | 'dismiss',
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update insight' },
      { status: 500 },
    )
  }
}
