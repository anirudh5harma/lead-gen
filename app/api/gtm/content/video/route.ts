import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createAvatarVideoJob } from '@/lib/gtm/avatar-video'
import { checkRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rate = await checkRateLimit(`marketing:avatar-video:${user.id}`, 20, 60 * 60, { supabase })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many avatar video requests. Try again later.' }, { status: 429 })

  const body = await request.json().catch(() => null) as { idea_id?: unknown; settings?: unknown } | null
  const ideaId = typeof body?.idea_id === 'string' ? body.idea_id.trim() : ''
  if (!ideaId) return NextResponse.json({ error: 'idea_id is required' }, { status: 400 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  try {
    const job = await createAvatarVideoJob(supabase, {
      userId: user.id,
      clientId: activeClientId,
      ideaId,
      settings: typeof body?.settings === 'object' && body.settings !== null && !Array.isArray(body.settings) ? body.settings as Record<string, unknown> : null,
    })
    return NextResponse.json({ ok: true, job })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to prepare avatar video' }, { status: 500 })
  }
}
