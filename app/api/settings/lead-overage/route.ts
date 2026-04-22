import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { allow_lead_overage?: boolean } | null
  if (typeof body?.allow_lead_overage !== 'boolean') {
    return NextResponse.json({ error: 'allow_lead_overage must be boolean' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', user.id)
    .single()

  const plan = profile?.plan ?? 'free'
  if (body.allow_lead_overage && plan === 'free') {
    return NextResponse.json({ error: 'Lead overages are only available on paid plans' }, { status: 403 })
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ allow_lead_overage: body.allow_lead_overage })
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, allow_lead_overage: body.allow_lead_overage })
}
