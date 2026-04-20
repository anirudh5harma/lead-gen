import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('scheduled_followups')
    .select('id, scheduled_for, lead_id, leads(id, target_company, status)')
    .eq('user_id', user.id)
    .is('sent_at', null)
    .order('scheduled_for', { ascending: true })
    .limit(25)

  return NextResponse.json({ followups: data ?? [] })
}
