/**
 * Cron — poll engagement metrics for published social posts (v2 Content engine).
 * Refreshes posts whose metrics are stale, feeding the reward loop.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { dispatchTask } from '@/lib/agents/core/supervisor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) { return run(request) }
export async function POST(request: Request) { return run(request) }

async function run(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createServiceClient()
  const staleBefore = new Date(Date.now() - 6 * 3600_000).toISOString()

  // distinct workspaces with published posts needing a refresh
  const { data: posts } = await supabase
    .from('posts')
    .select('user_id, workspace_id, metrics_fetched_at')
    .eq('status', 'published')
    .or(`metrics_fetched_at.is.null,metrics_fetched_at.lte.${staleBefore}`)
    .limit(500)

  const workspaces = new Map<string, { userId: string; clientId: string | null }>()
  for (const p of posts ?? []) {
    const wsId = p.workspace_id as string
    if (!workspaces.has(wsId)) workspaces.set(wsId, { userId: p.user_id as string, clientId: wsId !== p.user_id ? wsId : null })
  }

  let updated = 0
  const errors: string[] = []
  for (const ws of workspaces.values()) {
    try {
      const out = await dispatchTask(supabase, {
        userId: ws.userId, clientId: ws.clientId, role: 'engagement',
        task: { tool: 'bombsell.content.metrics', arguments: { limit: 25 } },
        sessionId: `cron-poll-post-metrics-${ws.userId}`,
      })
      updated += Number((out.result as { updated?: number } | undefined)?.updated ?? 0)
    } catch (e) {
      errors.push(`${ws.userId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return NextResponse.json({ ok: errors.length === 0, workspaces: workspaces.size, updated, errors: errors.length ? errors : undefined })
}
