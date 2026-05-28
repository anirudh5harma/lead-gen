import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { getGtmLaunchReadiness } from '@/lib/gtm/launch-readiness'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  try {
    const readiness = await getGtmLaunchReadiness(supabase, {
      userId: user.id,
      clientId: activeClientId,
    })
    return NextResponse.json(readiness)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load GTM readiness' },
      { status: 500 },
    )
  }
}
