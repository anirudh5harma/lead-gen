import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { buildGtmContextPack } from '@/lib/gtm/semantic-context'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const accountId = url.searchParams.get('account_id')
  const leadId = url.searchParams.get('lead_id')
  const query = url.searchParams.get('q')
  const limit = Number(url.searchParams.get('limit') ?? 12)
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    const context = await buildGtmContextPack(supabase, {
      userId: user.id,
      clientId: activeClientId,
      accountId,
      leadId,
      query,
      limit,
    })
    return NextResponse.json({ context })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load GTM context' },
      { status: 500 },
    )
  }
}
