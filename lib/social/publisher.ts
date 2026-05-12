/**
 * Social publisher — thin adapter over a posting partner (Typefully / Buffer /
 * Ayrshare). Native LinkedIn / X APIs can be added later behind the same
 * interface. If no partner is connected, the `manual` adapter is used: posts are
 * marked scheduled/published without an external call (the user posts by hand).
 *
 * See PLAN.md §3.4.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { postformeEnabled, publish as pfmPublish, getPostMetrics as pfmMetrics } from './postforme'

export type SocialPartner = 'postforme' | 'typefully' | 'buffer' | 'ayrshare' | 'manual'
export type SocialPlatform = 'linkedin' | 'x'

export interface PublishInput {
  platform: SocialPlatform
  body: string
  thread?: string[]            // follow-on posts (X threads, LinkedIn N/A)
  media?: Array<{ url: string; alt?: string }>
  scheduledAt?: string | null  // ISO; null/absent = publish now
}

export interface PublishResult {
  ok: boolean
  status: 'scheduled' | 'published' | 'failed'
  partner: SocialPartner
  partnerPostId?: string
  externalId?: string
  error?: string
}

export interface PostMetrics {
  impressions?: number
  likes?: number
  comments?: number
  reposts?: number
  followersDelta?: number
  fetchedAt: string
}

export interface SocialAdapter {
  readonly partner: SocialPartner
  publish(input: PublishInput): Promise<PublishResult>
  getMetrics(ref: { partnerPostId?: string; externalId?: string }): Promise<PostMetrics | null>
}

// ── manual adapter ────────────────────────────────────────────
class ManualAdapter implements SocialAdapter {
  readonly partner = 'manual' as const
  async publish(input: PublishInput): Promise<PublishResult> {
    return { ok: true, status: input.scheduledAt ? 'scheduled' : 'published', partner: 'manual' }
  }
  async getMetrics(): Promise<PostMetrics | null> {
    return null
  }
}

// ── Typefully adapter ─────────────────────────────────────────
// https://typefully.com — REST API keyed by `X-API-KEY`.
class TypefullyAdapter implements SocialAdapter {
  readonly partner = 'typefully' as const
  constructor(private apiKey: string) {}
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const content = [input.body, ...(input.thread ?? [])].join('\n\n\n\n') // 4 newlines = thread split in Typefully
      const res = await fetch('https://api.typefully.com/v1/drafts/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-KEY': `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          content,
          threadify: !!input.thread?.length,
          ...(input.scheduledAt ? { 'schedule-date': input.scheduledAt } : { 'schedule-date': 'next-free-slot' }),
        }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) return { ok: false, status: 'failed', partner: 'typefully', error: `Typefully ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` }
      const json = await res.json() as { id?: number | string }
      return { ok: true, status: input.scheduledAt ? 'scheduled' : 'published', partner: 'typefully', partnerPostId: json.id != null ? String(json.id) : undefined }
    } catch (e) {
      return { ok: false, status: 'failed', partner: 'typefully', error: e instanceof Error ? e.message : String(e) }
    }
  }
  async getMetrics(): Promise<PostMetrics | null> {
    // Typefully exposes published-tweet stats on paid tiers; left as a stub for now.
    return null
  }
}

// ── Buffer adapter ────────────────────────────────────────────
// Buffer API v1 — https://buffer.com/developers/api . Auth = OAuth2 access token
// (stored as `api_key`). Each connected platform is a Buffer "profile"; its id is
// stored in `social_accounts.external_account_id`.
class BufferAdapter implements SocialAdapter {
  readonly partner = 'buffer' as const
  constructor(private accessToken: string, private profileId: string) {}
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const text = [input.body, ...(input.thread ?? [])].join('\n\n')
      const form = new URLSearchParams()
      form.set('profile_ids[]', this.profileId)
      form.set('text', text)
      if (input.scheduledAt) form.set('scheduled_at', String(Math.floor(new Date(input.scheduledAt).getTime() / 1000)))
      else form.set('now', 'true')
      for (const m of input.media ?? []) { form.append('media[photo]', m.url) }
      const res = await fetch(`https://api.bufferapp.com/1/updates/create.json?access_token=${encodeURIComponent(this.accessToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) return { ok: false, status: 'failed', partner: 'buffer', error: `Buffer ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` }
      const json = await res.json() as { success?: boolean; updates?: Array<{ id?: string; status?: string }>; buffer_count?: number }
      const update = json.updates?.[0]
      const published = update?.status === 'sent' || input.scheduledAt == null
      return { ok: true, status: published ? 'published' : 'scheduled', partner: 'buffer', partnerPostId: update?.id }
    } catch (e) {
      return { ok: false, status: 'failed', partner: 'buffer', error: e instanceof Error ? e.message : String(e) }
    }
  }
  async getMetrics(ref: { partnerPostId?: string }): Promise<PostMetrics | null> {
    if (!ref.partnerPostId) return null
    try {
      const res = await fetch(`https://api.bufferapp.com/1/updates/${encodeURIComponent(ref.partnerPostId)}/interactions.json?access_token=${encodeURIComponent(this.accessToken)}&event=clicks`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return null
      // Buffer's `/updates/:id.json` carries `statistics` { reach, clicks, retweets, favorites, mentions, comments }
      const res2 = await fetch(`https://api.bufferapp.com/1/updates/${encodeURIComponent(ref.partnerPostId)}.json?access_token=${encodeURIComponent(this.accessToken)}`, { signal: AbortSignal.timeout(15_000) })
      if (!res2.ok) return null
      const json = await res2.json() as { statistics?: { reach?: number; clicks?: number; retweets?: number; reposts?: number; favorites?: number; likes?: number; comments?: number } }
      const s = json.statistics ?? {}
      return {
        impressions: s.reach,
        likes: s.likes ?? s.favorites,
        comments: s.comments,
        reposts: s.reposts ?? s.retweets,
        fetchedAt: new Date().toISOString(),
      }
    } catch { return null }
  }
}

// ── Ayrshare adapter ──────────────────────────────────────────
// https://www.ayrshare.com/docs — Bearer API key; one key posts to all linked
// social accounts. Platform is passed per call.
class AyrshareAdapter implements SocialAdapter {
  readonly partner = 'ayrshare' as const
  constructor(private apiKey: string) {}
  private platformName(p: SocialPlatform): string { return p === 'x' ? 'twitter' : 'linkedin' }
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const body: Record<string, unknown> = {
        post: input.body,
        platforms: [this.platformName(input.platform)],
        ...(input.scheduledAt ? { scheduleDate: input.scheduledAt } : {}),
        ...(input.media?.length ? { mediaUrls: input.media.map((m) => m.url) } : {}),
        ...(input.thread?.length && input.platform === 'x' ? { twitterOptions: { thread: true, threadNumber: false } } : {}),
      }
      if (input.thread?.length && input.platform === 'x') body.post = [input.body, ...input.thread].join('\n\n')
      const res = await fetch('https://app.ayrshare.com/api/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
      const json = await res.json().catch(() => ({})) as { status?: string; id?: string; errors?: unknown }
      if (!res.ok || json.status === 'error') return { ok: false, status: 'failed', partner: 'ayrshare', error: `Ayrshare: ${JSON.stringify(json.errors ?? json).slice(0, 200)}` }
      return { ok: true, status: input.scheduledAt ? 'scheduled' : 'published', partner: 'ayrshare', partnerPostId: json.id }
    } catch (e) {
      return { ok: false, status: 'failed', partner: 'ayrshare', error: e instanceof Error ? e.message : String(e) }
    }
  }
  async getMetrics(ref: { partnerPostId?: string }): Promise<PostMetrics | null> {
    if (!ref.partnerPostId) return null
    try {
      const res = await fetch('https://app.ayrshare.com/api/analytics/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ id: ref.partnerPostId }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return null
      const json = await res.json().catch(() => ({})) as Record<string, { analytics?: { impressions?: number; likeCount?: number; commentsCount?: number; shareCount?: number; retweetCount?: number; favoriteCount?: number } }>
      // shape: { linkedin: { analytics: {...} }, twitter: { analytics: {...} } }
      const first = Object.values(json).find((v) => v && typeof v === 'object' && 'analytics' in v)?.analytics
      if (!first) return null
      return {
        impressions: first.impressions,
        likes: first.likeCount ?? first.favoriteCount,
        comments: first.commentsCount,
        reposts: first.shareCount ?? first.retweetCount,
        fetchedAt: new Date().toISOString(),
      }
    } catch { return null }
  }
}

// ── Post for Me adapter (managed: one company key, per-workspace connections) ──
class PostForMeAdapter implements SocialAdapter {
  readonly partner = 'postforme' as const
  constructor(private accountIds: string[]) {}
  async publish(input: PublishInput): Promise<PublishResult> {
    if (this.accountIds.length === 0) return { ok: false, status: 'failed', partner: 'postforme', error: 'No social account connected for this platform' }
    const r = await pfmPublish({
      accountIds: this.accountIds,
      caption: input.body, media: input.media?.map((m) => ({ url: m.url })),
      thread: input.platform === 'x' ? input.thread : undefined,
      scheduledAt: input.scheduledAt ?? null,
    })
    if (!r.ok) return { ok: false, status: 'failed', partner: 'postforme', error: r.error }
    return { ok: true, status: r.status, partner: 'postforme', partnerPostId: r.postId }
  }
  async getMetrics(ref: { partnerPostId?: string }): Promise<PostMetrics | null> {
    if (!ref.partnerPostId) return null
    const m = await pfmMetrics(ref.partnerPostId)
    if (!m) return null
    return { ...m, fetchedAt: new Date().toISOString() }
  }
}

/**
 * Resolve the workspace's active social adapter. Preference: Post for Me
 * (managed, if the company key is configured) → Buffer / Typefully / Ayrshare
 * (BYO key) → `manual` (no external call; user posts by hand).
 */
export async function getSocialAdapter(
  supabase: SupabaseClient,
  workspaceId: string,
  platform?: SocialPlatform,
): Promise<SocialAdapter> {
  const { data } = await supabase
    .from('social_accounts')
    .select('partner, api_key, platform, external_account_id, metadata, is_active')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
  const rows = data ?? []

  // Managed Post for Me: gather the linked account ids for this platform.
  if (postformeEnabled()) {
    const pfmRows = rows.filter((r) => r.partner === 'postforme' && (!platform || !r.platform || r.platform === platform))
    const accountIds = pfmRows.map((r) => r.external_account_id as string).filter(Boolean)
    if (accountIds.length > 0) return new PostForMeAdapter(accountIds)
  }

  const row = rows.find((r) => r.partner !== 'postforme' && (!platform || !r.platform || r.platform === platform)) ?? rows.find((r) => r.partner !== 'postforme')
  if (!row) return new ManualAdapter()
  if (row.partner === 'buffer' && row.api_key) {
    const profileId = (row.external_account_id as string | null)
      ?? ((row.metadata as Record<string, string> | null)?.[`profile_${platform ?? ''}`] ?? '')
    if (profileId) return new BufferAdapter(row.api_key, profileId)
    return new ManualAdapter()
  }
  if (row.partner === 'typefully' && row.api_key) return new TypefullyAdapter(row.api_key)
  if (row.partner === 'ayrshare' && row.api_key) return new AyrshareAdapter(row.api_key)
  return new ManualAdapter()
}
