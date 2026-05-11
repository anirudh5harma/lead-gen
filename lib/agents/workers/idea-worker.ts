/**
 * Idea Agent Worker — generates scored content angles from recent buying
 * signals + the workspace's positioning, and lists pending ideas.
 * Tools: bombsell.idea.generate, bombsell.idea.list
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAgentEvent } from '@/lib/agent-events'
import type { WorkerTaskDispatch, WorkerTaskResult } from '../protocol/types'
import { resolveWorkspaceId } from '../core/workspace-agents'
import { complete, parseJsonLoose } from '@/lib/llm'

interface IdeaDraft { angle: string; hook?: string; rationale?: string; platform?: 'linkedin' | 'x' | 'both'; score?: number }

export async function run(
  supabase: SupabaseClient,
  dispatch: WorkerTaskDispatch,
  userId: string,
  clientId: string | null,
): Promise<WorkerTaskResult> {
  const start = Date.now()
  const workspaceId = resolveWorkspaceId(userId, clientId)
  try {
    let result: Record<string, unknown> = {}

    switch (dispatch.tool) {
      case 'bombsell.idea.generate': {
        const { count = 5, platform, topic } = dispatch.args as { count?: number; platform?: 'linkedin' | 'x' | 'both'; topic?: string }
        // workspace positioning
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('company_name, services_description, target_industries, icp_keywords')
          .eq('user_id', userId).maybeSingle()
        // recent signals (via leads the workspace has surfaced)
        const { data: leads } = await supabase
          .from('leads')
          .select('target_company, relevance_reason, signal_type')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(12)
        const signalLines = (leads ?? [])
          .map((l) => `- ${l.target_company ?? 'a company'}: ${l.relevance_reason ?? l.signal_type ?? 'recent activity'}`)
          .join('\n') || '- (no recent signals; use the positioning below)'

        const system = 'You are a B2B content strategist. Propose sharp, specific LinkedIn/X post angles a founder could publish this week. Be concrete; avoid generic advice. Respond with a JSON object {"ideas":[{"angle","hook","rationale","platform","score"}]} where platform is "linkedin"|"x"|"both" and score is 0-100 (publish-worthiness).'
        const prompt = [
          `Company: ${profile?.company_name ?? 'the company'}`,
          `What they do: ${profile?.services_description ?? '(unspecified)'}`,
          `Target industries: ${(profile?.target_industries ?? []).join(', ') || '(any)'}`,
          `ICP keywords: ${(profile?.icp_keywords ?? []).join(', ') || '(none)'}`,
          topic ? `Constrain ideas to this theme: ${topic}` : '',
          '',
          'Recent buying signals observed in their market:',
          signalLines,
          '',
          `Return exactly ${Math.min(Math.max(count, 1), 10)} ideas.`,
        ].filter(Boolean).join('\n')

        const { text, provider, byoKey } = await complete({ system, prompt, json: true, maxTokens: 1400, temperature: 0.7, supabase, workspaceId })
        const parsed = parseJsonLoose<{ ideas?: IdeaDraft[] }>(text)
        const ideas = (parsed?.ideas ?? []).slice(0, Math.min(Math.max(count, 1), 10))
        let inserted = 0
        for (const idea of ideas) {
          if (!idea?.angle) continue
          const { error } = await supabase.from('content_ideas').insert({
            workspace_id: workspaceId,
            user_id: userId,
            source: topic ? 'trend' : 'signal',
            platform: platform ?? (idea.platform === 'x' || idea.platform === 'both' ? idea.platform : 'linkedin'),
            angle: idea.angle.slice(0, 600),
            hook: idea.hook?.slice(0, 400) ?? null,
            rationale: idea.rationale?.slice(0, 800) ?? null,
            score: typeof idea.score === 'number' ? Math.max(0, Math.min(100, idea.score)) : 60,
            status: 'proposed',
            metadata: { llm_provider: provider },
          })
          if (!error) inserted++
        }
        await recordAgentEvent(supabase, {
          userId, clientId, agentName: 'idea',
          eventType: 'idea.generate.completed', status: 'completed',
          title: `Generated ${inserted} content idea(s)`,
          metadata: { inserted, requested: count, provider, byoKey },
        })
        result = { inserted, provider, ideas: ideas.map((i) => ({ angle: i.angle, hook: i.hook, score: i.score })) }
        break
      }

      case 'bombsell.idea.list': {
        const { limit = 20, status = 'proposed' } = dispatch.args as { limit?: number; status?: string }
        const { data } = await supabase
          .from('content_ideas')
          .select('id, platform, angle, hook, rationale, score, status, created_at')
          .eq('workspace_id', workspaceId)
          .eq('status', status)
          .order('score', { ascending: false })
          .limit(Math.min(limit, 100))
        result = { ideas: data ?? [] }
        break
      }

      default:
        throw new Error(`Unknown idea tool: ${dispatch.tool}`)
    }

    return { taskId: dispatch.taskId, traceId: dispatch.tracingContext.traceId, status: 'completed', result, creditsConsumed: 0.2, latencyMs: Date.now() - start }
  } catch (err) {
    return { taskId: dispatch.taskId, traceId: dispatch.tracingContext.traceId, status: 'failed', error: err instanceof Error ? err.message : String(err), creditsConsumed: 0, latencyMs: Date.now() - start }
  }
}
