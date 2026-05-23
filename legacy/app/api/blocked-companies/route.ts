import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  let query = supabase
    .from('blocked_companies')
    .select('id, company_name, company_domain, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ blocked: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const { company_name, company_domain } = await request.json() as {
    company_name: string
    company_domain?: string | null
  }

  if (!company_name) return NextResponse.json({ error: 'company_name required' }, { status: 400 })

  let existingQuery = supabase
    .from('blocked_companies')
    .select('id, company_name, company_domain')
    .eq('user_id', user.id)

  existingQuery = activeClientId
    ? existingQuery.eq('client_id', activeClientId)
    : existingQuery.is('client_id', null)

  existingQuery = company_domain
    ? existingQuery.eq('company_domain', company_domain)
    : existingQuery.ilike('company_name', company_name)

  const { data: existingBlock } = await existingQuery.maybeSingle()

  if (existingBlock) {
    return NextResponse.json({ block: existingBlock })
  }

  const { data: block, error: insertErr } = await supabase
    .from('blocked_companies')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      company_name,
      company_domain: company_domain ?? null,
    })
    .select('id, company_name, company_domain')
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Dismiss all existing leads from this company in one query
  const dismissFilter = company_domain
    ? supabase.from('leads').update({ status: 'dismissed' })
        .eq('user_id', user.id)
        .match(activeClientId ? { client_id: activeClientId } : {})
        .eq('company_domain', company_domain)
    : supabase.from('leads').update({ status: 'dismissed' })
        .eq('user_id', user.id)
        .match(activeClientId ? { client_id: activeClientId } : {})
        .ilike('target_company', company_name)

  await dismissFilter

  return NextResponse.json({ block })
}
