import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { listGtmWorkItems } from '@/lib/gtm/work-items'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit') ?? 30)
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    const result = await listGtmWorkItems(supabase, {
      userId: user.id,
      clientId: activeClientId,
      limit,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load GTM work items' },
      { status: 500 },
    )
  }
}
