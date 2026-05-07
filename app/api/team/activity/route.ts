import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceActivity } from '@/lib/team'
import { requirePlan } from '@/lib/api-plan-guard'

export async function GET(request: Request) {
  const supabase = await createClient()
  const planCheck = await requirePlan(supabase, 'scale')
  if (planCheck instanceof NextResponse) return planCheck
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id')
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '50')))

  if (!clientId) {
    return NextResponse.json({ error: 'Workspace ID is required.' }, { status: 400 })
  }

  const activities = await getWorkspaceActivity(supabase, clientId, limit)
  return NextResponse.json({ activities })
}
