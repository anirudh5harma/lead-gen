import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceMembers, removeTeamMember } from '@/lib/team'
import { requirePlan } from '@/lib/api-plan-guard'

export async function GET(request: Request) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'scale')
  if (planCheck instanceof NextResponse) return planCheck
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'Workspace ID is required.' }, { status: 400 })
  }

  const members = await getWorkspaceMembers(supabase, clientId)
  return NextResponse.json({ members })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'scale')
  if (planCheck instanceof NextResponse) return planCheck
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { member_id?: string; client_id?: string } | null
  if (!body?.member_id || !body?.client_id) {
    return NextResponse.json({ error: 'Member ID and workspace ID are required.' }, { status: 400 })
  }

  const result = await removeTeamMember(supabase, {
    requestedBy: user.id,
    clientId: body.client_id,
    memberId: body.member_id,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
