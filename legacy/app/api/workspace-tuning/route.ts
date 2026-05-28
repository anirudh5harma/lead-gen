/**
 * Reward-loop activity for the workspace — recent tuning cycles
 * ("what's working" / "what changed and why").
 * GET ?engine=outbound|content&limit=20
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  const workspaceId = (profile?.active_client_id as string | null) ?? user.id

  const url = new URL(request.url)
  const engine = url.searchParams.get('engine')
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100)

  let q = supabase.from('workspace_tuning_log')
    .select('id, engine, summary, changes, cycle_at')
    .eq('workspace_id', workspaceId)
    .order('cycle_at', { ascending: false })
    .limit(limit)
  if (engine === 'outbound' || engine === 'content') q = q.eq('engine', engine)
  const { data } = await q
  return NextResponse.json({ cycles: data ?? [] })
}
