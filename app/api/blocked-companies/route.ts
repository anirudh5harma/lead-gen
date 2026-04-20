import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('blocked_companies')
    .select('id, company_name, company_domain, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ blocked: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_name, company_domain } = await request.json() as {
    company_name: string
    company_domain?: string | null
  }

  if (!company_name) return NextResponse.json({ error: 'company_name required' }, { status: 400 })

  // Insert block — ignore conflict (already blocked)
  const { data: block, error: insertErr } = await supabase
    .from('blocked_companies')
    .upsert(
      { user_id: user.id, company_name, company_domain: company_domain ?? null },
      { onConflict: 'user_id,company_domain', ignoreDuplicates: false }
    )
    .select('id, company_name, company_domain')
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Dismiss all existing leads from this company in one query
  const dismissFilter = company_domain
    ? supabase.from('leads').update({ status: 'dismissed' })
        .eq('user_id', user.id)
        .eq('company_domain', company_domain)
    : supabase.from('leads').update({ status: 'dismissed' })
        .eq('user_id', user.id)
        .ilike('target_company', company_name)

  await dismissFilter

  return NextResponse.json({ block })
}
