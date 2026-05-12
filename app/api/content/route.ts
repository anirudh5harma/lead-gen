/**
 * Content engine — ideas & posts for the workspace.
 *
 * GET  ?resource=ideas[&status=proposed]   → content_ideas rows
 * GET  ?resource=posts[&status=...]         → posts rows
 * POST {action}:
 *   - 'generate_ideas'  { count?, platform?, topic? }   → dispatch idea.generate
 *   - 'write'           { ideaId, platform? }            → dispatch content.write
 *   - 'edit'            { postId }                       → dispatch content.edit
 *   - 'schedule'        { postId, scheduledAt }          → dispatch content.schedule
 *   - 'publish'         { postId }                       → dispatch content.publish
 *   - 'repurpose'       { postId? }                      → dispatch content.repurpose
 *   - 'set_idea_status' { ideaId, status }               → update content_ideas
 * PATCH { postId, hook?, body?, scheduledAt? }           → manual post edit
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchTask } from '@/lib/agents/core/supervisor'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  const clientId = (profile?.active_client_id as string | null) ?? null
  return { supabase, userId: user.id, clientId, workspaceId: clientId ?? user.id }
}

export async function GET(request: Request) {
  const c = await ctx()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const resource = url.searchParams.get('resource') ?? 'ideas'
  const status = url.searchParams.get('status')
  if (resource === 'posts') {
    let q = c.supabase.from('posts')
      .select('id, idea_id, platform, status, hook, body, thread, eval_score, eval_failed, scheduled_at, published_at, partner, metrics, metrics_fetched_at, error_message, created_at, updated_at')
      .eq('workspace_id', c.workspaceId).order('created_at', { ascending: false }).limit(200)
    if (status) q = q.eq('status', status)
    const { data } = await q
    return NextResponse.json({ posts: data ?? [] })
  }
  let q = c.supabase.from('content_ideas')
    .select('id, source, platform, angle, hook, rationale, score, status, created_at')
    .eq('workspace_id', c.workspaceId).order('score', { ascending: false }).limit(200)
  if (status) q = q.eq('status', status)
  const { data } = await q
  return NextResponse.json({ ideas: data ?? [] })
}

export async function POST(request: Request) {
  const c = await ctx()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action as string | undefined
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  const dispatch = (role: Parameters<typeof dispatchTask>[1]['role'], tool: string, args: Record<string, unknown>) =>
    dispatchTask(c.supabase, { userId: c.userId, clientId: c.clientId, role, task: { tool, arguments: args }, sessionId: `dashboard-content-${action}` })

  try {
    switch (action) {
      case 'generate_ideas': {
        const out = await dispatch('idea', 'bombsell.idea.generate', { count: body?.count ?? 5, platform: body?.platform, topic: body?.topic })
        return NextResponse.json({ ok: out.status === 'completed', result: out.result, error: out.error })
      }
      case 'write': {
        if (!body?.ideaId) return NextResponse.json({ error: 'ideaId required' }, { status: 400 })
        const out = await dispatch('writer', 'bombsell.content.write', { ideaId: body.ideaId, platform: body?.platform })
        return NextResponse.json({ ok: out.status === 'completed', result: out.result, error: out.error })
      }
      case 'edit': {
        if (!body?.postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
        const out = await dispatch('editor', 'bombsell.content.edit', { postId: body.postId })
        return NextResponse.json({ ok: out.status === 'completed', result: out.result, error: out.error })
      }
      case 'schedule': {
        if (!body?.postId || !body?.scheduledAt) return NextResponse.json({ error: 'postId & scheduledAt required' }, { status: 400 })
        const out = await dispatch('publisher', 'bombsell.content.schedule', { postId: body.postId, scheduledAt: body.scheduledAt })
        return NextResponse.json({ ok: out.status === 'completed', result: out.result, error: out.error })
      }
      case 'publish': {
        if (!body?.postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
        const out = await dispatch('publisher', 'bombsell.content.publish', { postId: body.postId })
        return NextResponse.json({ ok: out.status === 'completed', result: out.result, error: out.error })
      }
      case 'repurpose': {
        const out = await dispatch('repurpose', 'bombsell.content.repurpose', { postId: body?.postId })
        return NextResponse.json({ ok: out.status === 'completed', result: out.result, error: out.error })
      }
      case 'metrics': {
        const out = await dispatch('engagement', 'bombsell.content.metrics', { postId: body?.postId, limit: body?.limit ?? 25 })
        return NextResponse.json({ ok: out.status === 'completed', result: out.result, error: out.error })
      }
      case 'set_idea_status': {
        const status = body?.status as string | undefined
        if (!body?.ideaId || !status || !['proposed', 'approved', 'rejected', 'drafted'].includes(status)) return NextResponse.json({ error: 'ideaId & valid status required' }, { status: 400 })
        const { error } = await c.supabase.from('content_ideas').update({ status, updated_at: new Date().toISOString() }).eq('id', body.ideaId).eq('workspace_id', c.workspaceId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const c = await ctx()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { postId?: string; hook?: string; body?: string; scheduledAt?: string | null } | null
  if (!body?.postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.hook === 'string') update.hook = body.hook
  if (typeof body.body === 'string') update.body = body.body
  if (body.scheduledAt !== undefined) { update.scheduled_at = body.scheduledAt; update.status = body.scheduledAt ? 'scheduled' : 'edited' }
  const { error } = await c.supabase.from('posts').update(update).eq('id', body.postId).eq('workspace_id', c.workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
