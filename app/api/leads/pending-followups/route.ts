import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  let query = supabase
    .from('scheduled_followups')
    .select('id, scheduled_for, lead_id, leads(id, target_company, status)')
    .eq('user_id', user.id)
    .is('sent_at', null)
    .order('scheduled_for', { ascending: true })
    .limit(25)

  query = activeClientId ? query.eq('leads.client_id', activeClientId) : query.is('leads.client_id', null)
  const { data } = await query

  return NextResponse.json({ followups: data ?? [] })
}
