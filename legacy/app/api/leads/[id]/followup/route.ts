import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Mark as sent without sending — this prevents the cron from picking it up
  await supabase
    .from('scheduled_followups')
    .update({ sent_at: new Date().toISOString() })
    .eq('lead_id', id)
    .is('sent_at', null)

  return NextResponse.json({ success: true })
}
