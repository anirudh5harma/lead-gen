import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserPlan, getPlanLimits } from '@/lib/plan'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await getUserPlan(user.id)
  if (!getPlanLimits(plan).auto_send) {
    return NextResponse.json({ error: 'Auto-send is not available on your plan.' }, { status: 403 })
  }

  const body = await request.json() as { auto_send_enabled: boolean }
  if (typeof body.auto_send_enabled !== 'boolean') {
    return NextResponse.json({ error: 'auto_send_enabled must be a boolean' }, { status: 400 })
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ auto_send_enabled: body.auto_send_enabled })
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, auto_send_enabled: body.auto_send_enabled })
}
