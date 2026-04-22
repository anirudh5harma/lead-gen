import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildWorkspaceAccessPlan } from '@/lib/client-workspaces'
import type { PlanTier } from '@/lib/plan'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: clients, error: clientsErr }, { data: profile }] = await Promise.all([
    supabase
      .from('client_accounts')
      .select('id, name, industry, services_description, created_at, is_archived')
      .eq('user_id', user.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: true }),
    supabase
      .from('user_profiles')
      .select('active_client_id, plan')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (clientsErr) return NextResponse.json({ error: clientsErr.message }, { status: 500 })
  const plan = ((profile as { plan?: string | null } | null)?.plan ?? 'free') as PlanTier
  const activeClientId = (profile as { active_client_id?: string | null; plan?: string | null } | null)?.active_client_id ?? null
  const canManageMultiple = plan === 'max'
  const accessPlan = buildWorkspaceAccessPlan({
    plan,
    activeClientId,
    clients: (clients ?? []).map(client => ({
      id: client.id,
      is_archived: client.is_archived,
      created_at: client.created_at,
    })),
  })
  const visibleClients = (clients ?? []).filter(client => accessPlan.visibleClientIds.includes(client.id))

  return NextResponse.json({
    clients: visibleClients,
    activeClientId: accessPlan.keepClientId,
    canManageMultiple,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle()

  if (((profile as { plan?: string | null } | null)?.plan ?? 'free') !== 'max') {
    return NextResponse.json({ error: 'Multiple client workspaces are available on the Max plan.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { name?: string } | null
  const name = body?.name?.trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data: client, error } = await supabase
    .from('client_accounts')
    .insert({
      user_id: user.id,
      name,
      services_description: '',
      target_industries: [],
      icp_keywords: [],
    })
    .select('id, name, industry, services_description, created_at, is_archived')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase
    .from('user_profiles')
    .update({ active_client_id: client.id })
    .eq('user_id', user.id)

  return NextResponse.json({ client, activeClientId: client.id })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle()

  if (((profile as { plan?: string | null } | null)?.plan ?? 'free') !== 'max') {
    return NextResponse.json({ error: 'Multiple client workspaces are available on the Max plan.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { activeClientId?: string } | null
  const activeClientId = body?.activeClientId
  if (!activeClientId) return NextResponse.json({ error: 'activeClientId required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('client_accounts')
    .select('id')
    .eq('id', activeClientId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const { error } = await supabase
    .from('user_profiles')
    .update({ active_client_id: activeClientId })
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, activeClientId })
}
