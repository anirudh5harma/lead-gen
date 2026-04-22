import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  let query = supabase
    .from('watchlist_companies')
    .select('id, company_name, company_domain, notes, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ companies: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const body = await request.json()
  const { company_name, company_domain, notes } = body as {
    company_name?: string
    company_domain?: string
    notes?: string
  }

  if (!company_name?.trim()) {
    return NextResponse.json({ error: 'company_name required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('watchlist_companies')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      company_name: company_name.trim(),
      company_domain: company_domain?.trim() || null,
      notes: notes?.trim() || null,
    })
    .select('id, company_name, company_domain, notes, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already watching this company' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ company: data })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const { id } = await request.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let query = supabase
    .from('watchlist_companies')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
