import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let query = supabase
    .from('sequence_templates')
    .select('id, name, custom_instructions, followup_custom_instructions, is_default, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    name?: string
    custom_instructions?: string
    followup_custom_instructions?: string
    is_default?: boolean
  } | null

  const name = body?.name?.trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  if (body?.is_default) {
    let resetQuery = supabase
      .from('sequence_templates')
      .update({ is_default: false })
      .eq('user_id', user.id)
    resetQuery = activeClientId ? resetQuery.eq('client_id', activeClientId) : resetQuery.is('client_id', null)
    await resetQuery
  }

  const { data, error } = await supabase
    .from('sequence_templates')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      name,
      custom_instructions: body?.custom_instructions?.trim() || null,
      followup_custom_instructions: body?.followup_custom_instructions?.trim() || null,
      is_default: body?.is_default ?? false,
    })
    .select('id, name, custom_instructions, followup_custom_instructions, is_default, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: data })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    id?: string
    name?: string
    custom_instructions?: string
    followup_custom_instructions?: string
    is_default?: boolean
  } | null

  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  if (body.is_default) {
    let resetQuery = supabase
      .from('sequence_templates')
      .update({ is_default: false })
      .eq('user_id', user.id)
    resetQuery = activeClientId ? resetQuery.eq('client_id', activeClientId) : resetQuery.is('client_id', null)
    await resetQuery
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string') updates.name = body.name.trim()
  if (typeof body.custom_instructions === 'string') updates.custom_instructions = body.custom_instructions.trim() || null
  if (typeof body.followup_custom_instructions === 'string') updates.followup_custom_instructions = body.followup_custom_instructions.trim() || null
  if (typeof body.is_default === 'boolean') updates.is_default = body.is_default

  const { data, error } = await supabase
    .from('sequence_templates')
    .update(updates)
    .eq('id', body.id)
    .eq('user_id', user.id)
    .select('id, name, custom_instructions, followup_custom_instructions, is_default, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: data })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { id?: string } | null
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('sequence_templates')
    .delete()
    .eq('id', body.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
