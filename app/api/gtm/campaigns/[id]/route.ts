import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => null) as {
    action?: string
  } | null

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
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
      .eq('user_id', user.id)
      .match(clientFilter)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, status: nextStatus })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
