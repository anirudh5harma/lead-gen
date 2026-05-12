/**
 * Cron — publish due social posts (v2 Content engine).
 * Finds posts with status 'edited' or 'scheduled' whose scheduled_at has passed
 * (or that have no schedule yet) and runs the publisher agent on each.
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
  const nowIso = new Date().toISOString()

  const { data: due } = await supabase
    .from('posts')
    .select('id, user_id, workspace_id, scheduled_at')
    .in('status', ['edited', 'scheduled'])
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
    .limit(50)

  let published = 0
  const errors: string[] = []
  for (const p of due ?? []) {
    try {
      const clientId = p.workspace_id !== p.user_id ? (p.workspace_id as string) : null
      await dispatchTask(supabase, {
        userId: p.user_id as string,
        clientId,
        role: 'publisher',
        task: { tool: 'bombsell.content.publish', arguments: { postId: p.id } },
        sessionId: `cron-publish-posts-${p.id}`,
      })
      published++
    } catch (e) {
      errors.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return NextResponse.json({ ok: errors.length === 0, scanned: (due ?? []).length, published, errors: errors.length ? errors : undefined })
}
