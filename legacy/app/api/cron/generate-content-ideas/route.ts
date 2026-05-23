/**
 * Cron — generate content ideas for workspaces running the idea agent.
 * Skips workspaces that already have a healthy backlog of proposed ideas.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { dispatchTask } from '@/lib/agents/core/supervisor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const BACKLOG_CAP = 8

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) { return run(request) }
export async function POST(request: Request) { return run(request) }

async function run(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createServiceClient()

  const { data: rows } = await supabase
    .from('workspace_agents')
    .select('workspace_id, user_id')
    .eq('agent_role', 'idea')
    .eq('enabled', true)
    .limit(500)

  let triggered = 0, skipped = 0
  const errors: string[] = []
  for (const r of rows ?? []) {
    try {
      const { count } = await supabase
        .from('content_ideas')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', r.workspace_id)
        .eq('status', 'proposed')
      if ((count ?? 0) >= BACKLOG_CAP) { skipped++; continue }
      const clientId = r.workspace_id !== r.user_id ? (r.workspace_id as string) : null
      await dispatchTask(supabase, {
        userId: r.user_id as string, clientId, role: 'idea',
        task: { tool: 'bombsell.idea.generate', arguments: { count: 5 } },
        sessionId: `cron-generate-ideas-${r.workspace_id}`,
      })
      triggered++
    } catch (e) {
      errors.push(`${r.workspace_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return NextResponse.json({ ok: errors.length === 0, workspaces: (rows ?? []).length, triggered, skipped, errors: errors.length ? errors : undefined })
}
