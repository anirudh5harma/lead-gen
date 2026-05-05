import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { sanitizeSessionIds } from '@/lib/auto-send-policies'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  const { data: sessions, error } = await supabase
    .from('explore_runs')
    .select('id, prompt, generated_count, inserted_count, created_at, autopilot_status, completed_at')
    .eq('user_id', user.id)
    .eq('client_id', activeClientId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: policy } = await supabase
    .from('auto_send_policies')
    .select('target_explore_session_ids')
    .eq('user_id', user.id)
    .eq('client_id', activeClientId)
    .maybeSingle()

  const activeSessionIds = sanitizeSessionIds((policy as { target_explore_session_ids?: unknown })?.target_explore_session_ids)

  return NextResponse.json({
    sessions: (sessions ?? []).map(session => ({
      id: session.id,
      prompt: session.prompt,
      generated_count: session.generated_count,
      inserted_count: session.inserted_count,
      created_at: session.created_at,
      autopilot_status: session.autopilot_status,
      in_autopilot: activeSessionIds.includes(session.id),
    })),
  })
}
