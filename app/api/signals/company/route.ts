import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')?.trim()

  if (!name) {
    return NextResponse.json({ error: 'name query parameter required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Escape ILIKE wildcards in the user-supplied name to prevent pattern injection
  const sanitized = name.replace(/[%_]/g, (m) => `\\${m}`)

  const { data, error } = await supabase
    .from('signals')
    .select('id, signal_type, headline, summary, funding_amount, source_url, published_at, company_name, company_domain')
    .ilike('company_name', `%${sanitized}%`)
    .order('published_at', { ascending: true, nullsFirst: true })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ signals: data ?? [] })
}
