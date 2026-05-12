import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'
import { requirePlan } from '@/lib/api-plan-guard'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

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
  } | null

  const { activeClientId } = await getActiveClientContext(supabase, userId)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  if (body?.action === 'activate' || body?.action === 'pause' || body?.action === 'complete' || body?.action === 'dismiss') {
    const statusMap: Record<string, string> = {
      activate: 'active',
      pause: 'paused',
      complete: 'completed',
      dismiss: 'dismissed',
    }
    const nextStatus = statusMap[body.action]

    const { error } = await supabase
      .from('gtm_campaigns')
      .update({ status: nextStatus })
      .eq('id', id)
      .eq('user_id', userId)
      .match(clientFilter)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, status: nextStatus })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
