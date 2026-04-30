import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { getGtmAccountState } from '@/lib/gtm/account-state'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  try {
    const state = await getGtmAccountState(supabase, {
      userId: user.id,
      clientId: activeClientId,
      accountId: id,
    })
    if (!state) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    return NextResponse.json(state)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load account state' },
      { status: 500 },
    )
  }
}
