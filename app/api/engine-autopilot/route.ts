/**
 * Per-engine autopilot control.
 *
 *   GET  → returns { outbound: AutomationMode, content: AutomationMode, readiness }
 *   POST → { engine: 'outbound' | 'content', mode: AutomationMode }
 *
 * Why a single endpoint instead of two:
 *   - Outbound state lives on user_profiles.automation_mode + auto_send_policies.
 *   - Content state lives on workspace_agents (publisher.autonomy + writer/editor
 *     enabled flags).
 *   - The Settings UI wants both in one round-trip + a single error envelope
 *     when the readiness gate trips.
 *
 * The outbound path delegates to applyAutomationMode (shared with /api/autopilot
 * and /api/profile/field) so the auto_send_policies row stays in sync. The
 * content path writes the relevant workspace_agents rows directly.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { checkRateLimit } from '@/lib/rate-limit'
import { applyAutomationMode, loadReadiness, normalizeAutomationMode, type AutomationMode } from '@/lib/autopilot'
import { resolveWorkspaceId, updateWorkspaceAgent } from '@/lib/agents/core/workspace-agents'
import type { AgentRole } from '@/lib/agents/protocol/types'

type Engine = 'outbound' | 'content'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const workspaceId = resolveWorkspaceId(user.id, activeClientId)

  const [profileRes, agentsRes, readinessRes] = await Promise.all([
    supabase.from('user_profiles').select('automation_mode').eq('user_id', user.id).maybeSingle(),
    supabase.from('workspace_agents').select('agent_role, autonomy, enabled').eq('workspace_id', workspaceId).in('agent_role', ['publisher', 'writer', 'editor', 'idea']),
    loadReadiness(supabase, user.id),
  ])

  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 })
  if (agentsRes.error) return NextResponse.json({ error: agentsRes.error.message }, { status: 500 })

  const outbound = (profileRes.data?.automation_mode as AutomationMode | null) ?? 'approve_first'

  // Content autopilot is anchored on the publisher (the only acting role in the
  // content pipeline). research_only when publisher.enabled=false OR
  // autonomy='research_only'; autopilot when autonomy='autopilot'; else
  // approve_first. This matches what the operator-worker honours at run time.
  const agentMap = new Map<string, { autonomy: AutomationMode; enabled: boolean }>()
  for (const row of agentsRes.data ?? []) {
    agentMap.set(row.agent_role as string, {
      autonomy: (row.autonomy as AutomationMode) ?? 'approve_first',
      enabled: row.enabled !== false,
    })
  }
  const publisher = agentMap.get('publisher')
  const writer = agentMap.get('writer')
  const content: AutomationMode = !writer?.enabled
    ? 'research_only'
    : !publisher?.enabled
      ? 'approve_first'
      : publisher.autonomy

  return NextResponse.json({
    outbound,
    content,
    readiness: readinessRes.readiness,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await checkRateLimit(`engine-autopilot:${user.id}`, 30, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many autopilot changes. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const body = await request.json().catch(() => null) as { engine?: unknown; mode?: unknown } | null
  const engine = body?.engine === 'outbound' || body?.engine === 'content' ? (body.engine as Engine) : null
  const mode = normalizeAutomationMode(body?.mode)
  if (!engine) return NextResponse.json({ error: 'engine must be "outbound" or "content"' }, { status: 400 })
  if (!mode) return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  if (engine === 'outbound') {
    const result = await applyAutomationMode(supabase, {
      userId: user.id,
      clientId: activeClientId,
      mode,
      userEmail: user.email ?? null,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, readiness: result.readiness },
        { status: result.status ?? 500 },
      )
    }
    return NextResponse.json({ ok: true, engine, mode: result.mode, readiness: result.readiness })
  }

  // Content engine. We treat the three modes as a small state machine over
  // writer / editor / publisher to mirror the operator-worker's gating:
  //   research_only → ideas only, no drafts
  //   approve_first → ideas + drafts + edits, no auto-publish
  //   autopilot     → ideas + drafts + edits + auto-publish
  const workspaceId = resolveWorkspaceId(user.id, activeClientId)
  const writerEnabled = mode !== 'research_only'
  const editorEnabled = mode !== 'research_only'
  const publisherEnabled = mode !== 'research_only'

  type ContentRolePatch = {
    role: AgentRole
    enabled: boolean
    autonomy: AutomationMode
  }
  const patches: ContentRolePatch[] = [
    { role: 'idea', enabled: true, autonomy: 'approve_first' },
    { role: 'writer', enabled: writerEnabled, autonomy: 'approve_first' },
    { role: 'editor', enabled: editorEnabled, autonomy: 'approve_first' },
    { role: 'publisher', enabled: publisherEnabled, autonomy: mode },
  ]

  for (const patch of patches) {
    await updateWorkspaceAgent(supabase, {
      workspaceId,
      userId: user.id,
      role: patch.role,
      patch: { enabled: patch.enabled, autonomy: patch.autonomy },
    })
  }
  return NextResponse.json({ ok: true, engine, mode })
}
