import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { acceptTeamInvite } from '@/lib/team'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { token?: string } | null
  if (!body?.token) {
    return NextResponse.json({ error: 'Invite token is required.' }, { status: 400 })
  }

  const serviceSupabase = createAdminClient()
  const result = await acceptTeamInvite(serviceSupabase, {
    userId: user.id,
    userEmail: user.email,
    token: body.token,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    client_id: result.clientId,
    message: 'You have joined the workspace.',
  })
}
