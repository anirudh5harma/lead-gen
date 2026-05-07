import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTeamInvite } from '@/lib/team'
import { requirePlan } from '@/lib/api-plan-guard'

export async function POST(request: Request) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'scale')
  if (planCheck instanceof NextResponse) return planCheck
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    client_id?: string
    email?: string
    role?: 'admin' | 'member'
  } | null

  if (!body?.client_id || !body?.email) {
    return NextResponse.json({ error: 'Workspace and email are required.' }, { status: 400 })
  }

  const email = body.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
  }

  const result = await createTeamInvite(supabase, {
    clientId: body.client_id,
    invitedBy: user.id,
    invitedEmail: email,
    role: body.role === 'admin' ? 'admin' : 'member',
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    invite: result.invite,
    message: `Invite sent to ${email}.`,
  })
}
