import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { listCoverageRecommendations, updateCoverageRecommendation } from '@/lib/gtm/coverage-optimizer'
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
    const result = await listCoverageRecommendations(supabase, {
      userId: user.id,
      clientId: activeClientId,
      limit,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load coverage recommendations' },
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

  const payload = body as { recommendation_id?: unknown; action?: unknown }
  const recommendationId = typeof payload.recommendation_id === 'string' ? payload.recommendation_id.trim() : ''
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''
  if (!recommendationId || !['apply', 'dismiss'].includes(action)) {
    return NextResponse.json({ error: 'recommendation_id and valid action are required' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    await updateCoverageRecommendation(supabase, {
      userId: user.id,
      clientId: activeClientId,
      recommendationId,
      action: action as 'apply' | 'dismiss',
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update coverage recommendation' },
      { status: 500 },
    )
  }
}
