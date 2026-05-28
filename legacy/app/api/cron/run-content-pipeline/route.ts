/**
 * Cron — auto-draft posts from proposed content ideas.
 *
 * Bridges the gap between cron/generate-content-ideas (which only stages
 * ideas at status='proposed') and the manual composer. For each workspace
 * with the `writer` agent enabled, picks the top-scored proposed ideas and
 * dispatches `bombsell.content.write` so a draft post appears in the
 * composer. If the editor is enabled, the resulting draft is also passed
 * through `bombsell.content.edit` for the brand-voice / format pass.
 *
 * When the publisher agent is set to autonomy='autopilot' (and enabled),
 * freshly-edited posts are scheduled ~24h out — staggered so we never
 * surprise-spam LinkedIn/X. The publish-posts cron handles the actual
 * publishing once the scheduled timestamp passes.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { dispatchTask } from '@/lib/agents/core/supervisor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_WORKSPACES_PER_RUN = 50
const MAX_IDEAS_PER_WORKSPACE = 2
const PUBLISH_LOOKAHEAD_HOURS = 24
const MAX_AUTO_SCHEDULED_PER_DAY = 2

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) { return run(request) }
export async function POST(request: Request) { return run(request) }

async function run(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createServiceClient()

  // Source-of-truth for "should we draft for this workspace" is the writer
  // agent being enabled. Reading directly from workspace_agents matches the
  // idea cron's filter and dodges any need for an extra preference table.
  const { data: writerRows, error: writerErr } = await supabase
    .from('workspace_agents')
    .select('workspace_id, user_id')
    .eq('agent_role', 'writer')
    .eq('enabled', true)
    .limit(MAX_WORKSPACES_PER_RUN)
  if (writerErr) return NextResponse.json({ error: writerErr.message }, { status: 500 })

  let drafted = 0
  let edited = 0
  let scheduled = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of writerRows ?? []) {
    const workspaceId = row.workspace_id as string
    const userId = row.user_id as string
    const clientId = workspaceId !== userId ? workspaceId : null

    try {
      const { data: ideas } = await supabase
        .from('content_ideas')
        .select('id, score')
        .eq('workspace_id', workspaceId)
        .eq('status', 'proposed')
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(MAX_IDEAS_PER_WORKSPACE)

      if (!ideas?.length) { skipped++; continue }

      // Confirm the editor + publisher state once per workspace — re-fetching
      // inside the idea loop would be wasteful since enable state can't change
      // mid-run.
      const { data: agentRows } = await supabase
        .from('workspace_agents')
        .select('agent_role, autonomy, enabled')
        .eq('workspace_id', workspaceId)
        .in('agent_role', ['editor', 'publisher'])
      const agents = new Map<string, { autonomy: string; enabled: boolean }>()
      for (const a of agentRows ?? []) {
        agents.set(a.agent_role as string, {
          autonomy: (a.autonomy as string) ?? 'approve_first',
          enabled: a.enabled !== false,
        })
      }
      const editorEnabled = Boolean(agents.get('editor')?.enabled)
      const publisher = agents.get('publisher')
      const autopilotPublishing = Boolean(publisher?.enabled) && publisher?.autonomy === 'autopilot'

      // When auto-publishing is on, cap how many we add to the next 24h window
      // so a backlog of ideas can't blast the user's feed in one day.
      let remainingAutoSchedule = MAX_AUTO_SCHEDULED_PER_DAY
      if (autopilotPublishing) {
        const lookahead = new Date(Date.now() + PUBLISH_LOOKAHEAD_HOURS * 60 * 60 * 1000).toISOString()
        const { count } = await supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('status', 'scheduled')
          .not('scheduled_at', 'is', null)
          .lte('scheduled_at', lookahead)
        remainingAutoSchedule = Math.max(0, MAX_AUTO_SCHEDULED_PER_DAY - (count ?? 0))
      }

      for (const idea of ideas) {
        try {
          const writeResult = await dispatchTask(supabase, {
            userId,
            clientId,
            role: 'writer',
            task: { tool: 'bombsell.content.write', arguments: { ideaId: idea.id } },
            sessionId: `cron-content-pipeline-${idea.id}`,
          })
          const posts = ((writeResult.result as { posts?: Array<{ postId?: string }> } | undefined)?.posts ?? [])
            .map(p => p.postId)
            .filter((id): id is string => typeof id === 'string')
          drafted += posts.length

          for (const postId of posts) {
            if (editorEnabled) {
              try {
                await dispatchTask(supabase, {
                  userId,
                  clientId,
                  role: 'editor',
                  task: { tool: 'bombsell.content.edit', arguments: { postId } },
                  sessionId: `cron-content-pipeline-edit-${postId}`,
                })
                edited++
              } catch (editErr) {
                errors.push(`edit ${postId}: ${editErr instanceof Error ? editErr.message : String(editErr)}`)
              }
            }

            if (autopilotPublishing && remainingAutoSchedule > 0) {
              try {
                // Schedule ~24h out to give the user time to intervene. Stagger
                // when we have multiple posts so they don't all hit the feed
                // at the same minute.
                const offsetHours = PUBLISH_LOOKAHEAD_HOURS - (MAX_AUTO_SCHEDULED_PER_DAY - remainingAutoSchedule) * 4
                const scheduledAt = new Date(Date.now() + offsetHours * 60 * 60 * 1000).toISOString()
                await dispatchTask(supabase, {
                  userId,
                  clientId,
                  role: 'publisher',
                  task: { tool: 'bombsell.content.schedule', arguments: { postId, scheduledAt } },
                  sessionId: `cron-content-pipeline-schedule-${postId}`,
                })
                scheduled++
                remainingAutoSchedule--
              } catch (scheduleErr) {
                errors.push(`schedule ${postId}: ${scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr)}`)
              }
            }
          }
        } catch (writeErr) {
          errors.push(`write ${idea.id}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`)
        }
      }
    } catch (wsErr) {
      errors.push(`workspace ${workspaceId}: ${wsErr instanceof Error ? wsErr.message : String(wsErr)}`)
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    workspaces: writerRows?.length ?? 0,
    drafted,
    edited,
    scheduled,
    skipped,
    errors: errors.length ? errors : undefined,
  })
}
