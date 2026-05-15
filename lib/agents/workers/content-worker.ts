/**
 * Content Agent Worker — covers the writer / editor / publisher / engagement /
 * repurpose roles (all under the `bombsell.content.*` tool namespace).
 * Tools:
 *   bombsell.content.write      — draft a post from an idea (handles 'both' platform)
 *   bombsell.content.thread     — expand a post into a thread (X)
 *   bombsell.content.edit       — brand-voice & format pass + eval
 *   bombsell.content.schedule   — schedule via posting partner
 *   bombsell.content.publish    — publish now via posting partner
 *   bombsell.content.metrics    — pull engagement metrics for published posts
 *   bombsell.content.repurpose  — turn a top post into a new idea
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAgentEvent } from '@/lib/agent-events'
import type { WorkerTaskDispatch, WorkerTaskResult } from '../protocol/types'
import { resolveWorkspaceId, loadWorkspaceAgents, getAgentConfig } from '../core/workspace-agents'
import { complete, parseJsonLoose } from '@/lib/llm'
import { evaluateContentPost, recordContentEvalTrace, type ContentPlatform } from '@/lib/gtm/content-eval'
import { getSocialAdapter } from '@/lib/social/publisher'
import { debitOutcome, postCrossedEngagementBar } from '@/lib/credits/outcomes'

type Platform = ContentPlatform

const PLATFORM_GUIDE: Record<Platform, string> = {
  linkedin: 'LinkedIn: 1–3 short paragraphs, a strong first-line hook, line breaks for skimming, max ~1 hashtag, end with a question or soft CTA. No "I am thrilled to announce".',
  x: 'X/Twitter: ≤280 chars per post. Write like a sharp, opinionated founder — contrarian takes, hot observations, numbered insights, or "unpopular opinion" framing. Short punchy sentences. No corporate jargon, no fluff, no "thread 🧵" emoji. Every word earns its place. If the idea needs more room, return a "thread" array of follow-on posts where each post is self-contained and scroll-stopping.',
}

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
      // ── write ────────────────────────────────────────────────────────────────
      case 'bombsell.content.write': {
        const { ideaId, platform: overridePlatform } = dispatch.args as { ideaId?: string; platform?: Platform }
        if (!ideaId) throw new Error('ideaId required')
        const { data: idea } = await supabase
          .from('content_ideas').select('id, angle, hook, rationale, platform').eq('id', ideaId).eq('workspace_id', workspaceId).maybeSingle()
        if (!idea) throw new Error('idea not found')

        // Resolve target platforms: 'both' → ['linkedin', 'x']; otherwise single-element
        const rawPlatform = overridePlatform ?? (idea.platform as string) ?? 'linkedin'
        const platforms: Platform[] = rawPlatform === 'both'
          ? ['linkedin', 'x']
          : [(rawPlatform === 'x' ? 'x' : 'linkedin')]

        const { data: profile } = await supabase.from('user_profiles').select('company_name, services_description').eq('user_id', userId).maybeSingle()
        const wsAgents = await loadWorkspaceAgents(supabase, workspaceId)
        const voice = (getAgentConfig(wsAgents, 'writer').voice as string) ?? ''

        const generated: Array<{ postId: string; platform: Platform; hook: string | null; body: string }> = []

        for (const plat of platforms) {
          const system = `You write high-performing social posts. ${PLATFORM_GUIDE[plat]} ${voice ? `Brand voice: ${voice}.` : ''} Respond with JSON {"hook": "...", "body": "...", "thread": ["...", "..."]} where "thread" is optional and only for X when needed.`
          const prompt = [
            `Company: ${profile?.company_name ?? ''} — ${profile?.services_description ?? ''}`,
            `Angle: ${idea.angle}`,
            idea.hook ? `Suggested hook: ${idea.hook}` : '',
            idea.rationale ? `Why it works: ${idea.rationale}` : '',
            `Platform: ${plat}`,
          ].filter(Boolean).join('\n')
          const { text, provider } = await complete({ system, prompt, json: true, maxTokens: 900, temperature: 0.7, supabase, workspaceId })
          const parsed = parseJsonLoose<{ hook?: string; body?: string; thread?: string[] }>(text) ?? {}
          const body = (parsed.body ?? '').trim() || idea.angle
          const { data: post, error } = await supabase.from('posts').insert({
            workspace_id: workspaceId, user_id: userId, idea_id: ideaId, platform: plat,
            status: 'draft', hook: parsed.hook ?? null, body,
            thread: Array.isArray(parsed.thread) && parsed.thread.length ? parsed.thread : null,
            metadata: { llm_provider: provider },
          }).select('id').single()
          if (error) throw new Error(error.message)
          generated.push({ postId: post?.id, platform: plat, hook: parsed.hook ?? null, body })
          await recordAgentEvent(supabase, { userId, clientId, agentName: 'writer', eventType: 'content.write.completed', status: 'completed', title: `Drafted ${plat} post`, metadata: { postId: post?.id, platform: plat, provider } })
        }

        await supabase.from('content_ideas').update({ status: 'drafted', updated_at: new Date().toISOString() }).eq('id', ideaId)
        result = { posts: generated.map(g => ({ postId: g.postId, platform: g.platform, hook: g.hook, body: g.body })) }
        break
      }

      // ── thread ───────────────────────────────────────────────────────────────
      case 'bombsell.content.thread': {
        const { postId } = dispatch.args as { postId?: string }
        if (!postId) throw new Error('postId required')
        const { data: post } = await supabase.from('posts').select('id, body, platform').eq('id', postId).eq('workspace_id', workspaceId).maybeSingle()
        if (!post) throw new Error('post not found')
        const { text } = await complete({
          system: 'Expand this into a tight X thread. Respond with JSON {"thread":["post1","post2",...]} where post1 is the hook. ≤280 chars each.',
          prompt: post.body, json: true, maxTokens: 800, temperature: 0.6, supabase, workspaceId,
        })
        const parsed = parseJsonLoose<{ thread?: string[] }>(text)
        const thread = (parsed?.thread ?? []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
        await supabase.from('posts').update({ thread: thread.length ? thread : null, updated_at: new Date().toISOString() }).eq('id', postId)
        result = { postId, threadLength: thread.length }
        break
      }

      // ── edit (brand voice + format + eval) ───────────────────────────────────
      case 'bombsell.content.edit': {
        const { postId } = dispatch.args as { postId?: string }
        if (!postId) throw new Error('postId required')
        const { data: post } = await supabase.from('posts').select('id, hook, body, platform').eq('id', postId).eq('workspace_id', workspaceId).maybeSingle()
        if (!post) throw new Error('post not found')
        const plat = post.platform as Platform
        const wsAgents = await loadWorkspaceAgents(supabase, workspaceId)
        const editorCfg = getAgentConfig(wsAgents, 'editor')
        const banned = (editorCfg.bannedPhrases as string[]) ?? []
        const maxHashtags = typeof editorCfg.maxHashtags === 'number' ? editorCfg.maxHashtags : 3

        let hook = post.hook as string | null
        let body = post.body as string
        let ev = evaluateContentPost({ platform: plat, hook, body, bannedPhrases: banned, maxHashtags })
        if (ev.failed.length > 0) {
          const { text } = await complete({
            system: `Rewrite this ${plat} post to fix these issues: ${ev.failed.join(', ')}. ${PLATFORM_GUIDE[plat]} ${banned.length ? `Never use: ${banned.join(', ')}.` : ''} Respond with JSON {"hook","body"}.`,
            prompt: `${hook ? `Hook: ${hook}\n` : ''}${body}`, json: true, maxTokens: 900, temperature: 0.5, supabase, workspaceId,
          })
          const parsed = parseJsonLoose<{ hook?: string; body?: string }>(text)
          if (parsed?.body?.trim()) { body = parsed.body.trim(); hook = parsed.hook ?? hook }
          ev = evaluateContentPost({ platform: plat, hook, body, bannedPhrases: banned, maxHashtags })
        }
        await supabase.from('posts').update({
          hook, body, status: 'edited', eval_score: ev.score, eval_failed: ev.failed, updated_at: new Date().toISOString(),
        }).eq('id', postId)
        await recordContentEvalTrace(supabase, { userId, clientId, postId, eval: ev, type: 'content_post_quality' })
        await recordAgentEvent(supabase, { userId, clientId, agentName: 'editor', eventType: 'content.edit.completed', status: 'completed', title: `Edited post — score ${ev.score}`, metadata: { postId, score: ev.score, failed: ev.failed } })
        result = { postId, score: ev.score, failed: ev.failed }
        break
      }

      // ── schedule / publish ───────────────────────────────────────────────────
      case 'bombsell.content.schedule':
      case 'bombsell.content.publish': {
        const { postId, scheduledAt } = dispatch.args as { postId?: string; scheduledAt?: string }
        if (!postId) throw new Error('postId required')
        const { data: post } = await supabase.from('posts').select('id, hook, body, thread, media, platform, eval_score, eval_failed').eq('id', postId).eq('workspace_id', workspaceId).maybeSingle()
        if (!post) throw new Error('post not found')
        const plat = post.platform as Platform
        // gate on eval
        const ev = evaluateContentPost({ platform: plat, hook: post.hook as string | null, body: post.body as string })
        if (ev.score < 50) {
          result = { postId, published: false, reason: 'eval_below_threshold', score: ev.score, failed: ev.failed }
          await recordAgentEvent(supabase, { userId, clientId, agentName: 'publisher', eventType: 'content.publish.blocked', status: 'blocked', title: `Post blocked from publishing — eval ${ev.score}`, metadata: { postId, score: ev.score, failed: ev.failed } })
          break
        }
        const wantSchedule = dispatch.tool === 'bombsell.content.schedule' && scheduledAt
        if (wantSchedule) {
          await supabase.from('posts').update({
            status: 'scheduled',
            scheduled_at: scheduledAt,
            error_message: null,
            updated_at: new Date().toISOString(),
          }).eq('id', postId)
          await recordAgentEvent(supabase, {
            userId, clientId, agentName: 'publisher',
            eventType: 'content.scheduled', status: 'completed',
            title: 'Post scheduled',
            metadata: { postId, scheduledAt },
          })
          result = { postId, status: 'scheduled', partner: null, partnerPostId: null, error: null }
          break
        }
        const adapter = await getSocialAdapter(supabase, workspaceId, plat)
        const pub = await adapter.publish({
          platform: plat,
          body: [post.hook ? `${post.hook}\n\n` : '', post.body].join('').trim(),
          thread: Array.isArray(post.thread) ? (post.thread as string[]) : undefined,
          media: Array.isArray(post.media) ? (post.media as Array<{ url: string; alt?: string }>) : undefined,
          scheduledAt: null,
        })
        await supabase.from('posts').update({
          status: pub.status === 'failed' ? 'failed' : pub.status,
          partner: pub.partner,
          partner_post_id: pub.partnerPostId ?? null,
          external_id: pub.externalId ?? null,
          scheduled_at: null,
          published_at: pub.status === 'published' ? new Date().toISOString() : null,
          error_message: pub.error ?? null,
          updated_at: new Date().toISOString(),
        }).eq('id', postId)
        // outcome debit on actual publish (idempotent per post; scheduling alone isn't charged)
        if (pub.status === 'published') {
          await debitOutcome(supabase, { userId, clientId, event: 'content_post_published', postId, note: `published via ${pub.partner}` })
        }
        await recordAgentEvent(supabase, {
          userId, clientId, agentName: 'publisher',
          eventType: `content.${pub.status}`, status: pub.status === 'failed' ? 'failed' : 'completed',
          title: pub.status === 'failed' ? `Publish failed: ${pub.error ?? 'unknown'}` : `Post ${pub.status} (${pub.partner})`,
          metadata: { postId, partner: pub.partner, status: pub.status },
        })
        result = { postId, status: pub.status, partner: pub.partner, partnerPostId: pub.partnerPostId ?? null, error: pub.error ?? null }
        break
      }

      // ── metrics ──────────────────────────────────────────────────────────────
      case 'bombsell.content.metrics': {
        const { postId, limit = 25 } = dispatch.args as { postId?: string; limit?: number }
        let q = supabase.from('posts').select('id, platform, partner, partner_post_id, external_id, metrics').eq('workspace_id', workspaceId).eq('status', 'published')
        if (postId) q = q.eq('id', postId)
        else q = q.order('metrics_fetched_at', { ascending: true, nullsFirst: true }).limit(Math.min(limit, 100))
        const { data: posts } = await q
        let updated = 0
        for (const p of posts ?? []) {
          const adapter = await getSocialAdapter(supabase, workspaceId, p.platform as Platform)
          const m = await adapter.getMetrics({ partnerPostId: p.partner_post_id ?? undefined, externalId: p.external_id ?? undefined })
          if (!m) continue
          await supabase.from('posts').update({ metrics: { ...m }, metrics_fetched_at: m.fetchedAt }).eq('id', p.id)
          const engagement = (m.likes ?? 0) + (m.comments ?? 0) + (m.reposts ?? 0)
          const impressions = m.impressions ?? 0
          const rate = impressions > 0 ? engagement / impressions : 0
          await recordContentEvalTrace(supabase, {
            userId, clientId, postId: p.id,
            eval: { score: Math.round(Math.min(100, rate * 1000)), checks: {}, failed: [], version: 'content-engagement@1' },
            type: 'content_engagement',
            metadata: { impressions, engagement, engagement_rate: rate },
          })
          // bonus outcome debit: a post that "worked"
          if (postCrossedEngagementBar(m)) {
            await debitOutcome(supabase, { userId, clientId, event: 'content_post_winner', postId: p.id, note: 'post crossed engagement threshold', metadata: { impressions, engagement } })
          }
          updated++
        }
        result = { updated, scanned: (posts ?? []).length }
        break
      }

      // ── repurpose ────────────────────────────────────────────────────────────
      case 'bombsell.content.repurpose': {
        const { postId } = dispatch.args as { postId?: string }
        let src = postId
        if (!src) {
          // pick the top-performing published post
          const { data } = await supabase.from('posts').select('id, metrics').eq('workspace_id', workspaceId).eq('status', 'published').limit(50)
          src = (data ?? []).map((p) => ({ id: p.id, eng: ((p.metrics as Record<string, number> | null)?.likes ?? 0) + ((p.metrics as Record<string, number> | null)?.comments ?? 0) })).sort((a, b) => b.eng - a.eng)[0]?.id
        }
        if (!src) { result = { repurposed: false, reason: 'no_published_posts' }; break }
        const { data: post } = await supabase.from('posts').select('id, body, platform').eq('id', src).eq('workspace_id', workspaceId).maybeSingle()
        if (!post) throw new Error('post not found')
        const { text } = await complete({
          system: 'Turn this into a fresh angle for a new post (different framing, same core insight). Respond with JSON {"angle","hook","rationale","platform"}.',
          prompt: post.body, json: true, maxTokens: 500, temperature: 0.8, supabase, workspaceId,
        })
        const parsed = parseJsonLoose<{ angle?: string; hook?: string; rationale?: string; platform?: 'linkedin' | 'x' | 'both' }>(text)
        if (!parsed?.angle) { result = { repurposed: false, reason: 'llm_no_angle' }; break }
        const { data: idea } = await supabase.from('content_ideas').insert({
          workspace_id: workspaceId, user_id: userId, source: 'repurpose',
          platform: parsed.platform ?? (post.platform as Platform), angle: parsed.angle.slice(0, 600),
          hook: parsed.hook?.slice(0, 400) ?? null, rationale: parsed.rationale?.slice(0, 800) ?? null,
          score: 65, status: 'proposed', metadata: { repurposed_from: src },
        }).select('id').single()
        result = { repurposed: true, fromPostId: src, ideaId: idea?.id }
        break
      }

      default:
        throw new Error(`Unknown content tool: ${dispatch.tool}`)
    }

    return { taskId: dispatch.taskId, traceId: dispatch.tracingContext.traceId, status: 'completed', result, creditsConsumed: 0.2, latencyMs: Date.now() - start }
  } catch (err) {
    return { taskId: dispatch.taskId, traceId: dispatch.tracingContext.traceId, status: 'failed', error: err instanceof Error ? err.message : String(err), creditsConsumed: 0, latencyMs: Date.now() - start }
  }
}
