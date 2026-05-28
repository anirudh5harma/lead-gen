/**
 * Recent agent events — backs the Agents → Activity tab in the dashboard.
 *
 * GET /api/agents/events?limit=20  → most recent agent_events rows for the caller.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 100)

  const { data, error } = await supabase
    .from('agent_events')
    .select('id, agent_name, event_type, status, title, body, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message, events: [] }, { status: 200 })
  }

  return NextResponse.json({ events: data ?? [] })
}
