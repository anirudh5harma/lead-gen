/**
 * Post for Me (https://www.postforme.dev) — unified social-posting API.
 * Validated against https://api.postforme.dev/docs (OpenAPI 3.0).
 *
 * Model: ONE company API key (env `POSTFORME_API_KEY`). Each connected account
 * is tagged with `external_id = workspaceId` so we can list a workspace's
 * accounts. A connected account = a `social_accounts` row (partner `postforme`,
 * `external_account_id` = the Post for Me account id).
 *
 * Base URL: https://api.postforme.dev   Auth: `Authorization: Bearer <key>`
 * Endpoints used:
 *   POST /v1/social-accounts/auth-url   → hosted OAuth URL for the user
 *   GET  /v1/social-accounts            → list (filter by external_id, platform, status)
 *   POST /v1/social-posts               → create/schedule a post
 *   GET  /v1/social-post-results        → per-post results / metrics (filter by post_id)
 *   POST /v1/social-accounts/{id}/disconnect
 *
 * IMPORTANT: Post for Me also requires a default OAuth redirect URL configured
 * in your dashboard. We pass `redirect_url_override` per call (our callback),
 * but set the dashboard default too as a fallback.
 */

const BASE = (process.env.POSTFORME_API_BASE || 'https://api.postforme.dev').replace(/\/$/, '')

export function postformeEnabled(): boolean {
  return !!(process.env.POSTFORME_API_KEY && process.env.POSTFORME_API_KEY.trim())
}

function headers(): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${process.env.POSTFORME_API_KEY ?? ''}` }
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) })
    const data = await res.json().catch(() => null) as T | null
    if (!res.ok) {
      const msg = (data as { message?: string; error?: string } | null)
      return { ok: false, status: res.status, data, error: msg?.message ?? msg?.error ?? `Post for Me ${res.status}` }
    }
    return { ok: true, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// Post for Me platform ids match ours exactly: 'linkedin' | 'x'.
export type PostForMePlatform = 'linkedin' | 'x'

/** POST /v1/social-accounts/auth-url — returns the hosted OAuth URL the user
 *  authorizes on. `externalId` is our workspace id; `redirectUrl` overrides the
 *  dashboard default redirect for this flow. */
export async function createConnectUrl(opts: { platform: PostForMePlatform; redirectUrl: string; externalId: string }): Promise<{ ok: boolean; url?: string; error?: string }> {
  const r = await call<{ url?: string; platform?: string }>(`/v1/social-accounts/auth-url`, {
    method: 'POST',
    body: JSON.stringify({ platform: opts.platform, external_id: opts.externalId, redirect_url_override: opts.redirectUrl }),
  })
  if (!r.ok || !r.data?.url) return { ok: false, error: r.error ?? 'Could not start Post for Me connect flow' }
  return { ok: true, url: r.data.url }
}

export interface PostForMeAccount { id: string; platform: string; username?: string; user_id?: string; status?: string; external_id?: string; profile_photo_url?: string }

/** GET /v1/social-accounts — connected accounts for a workspace. */
export async function listAccounts(opts?: { externalId?: string; platform?: PostForMePlatform }): Promise<PostForMeAccount[]> {
  const qs = new URLSearchParams()
  if (opts?.externalId) qs.set('external_id', opts.externalId)
  if (opts?.platform) qs.set('platform', opts.platform)
  qs.set('status', 'connected')
  const r = await call<{ data?: PostForMeAccount[] }>(`/v1/social-accounts?${qs.toString()}`, { method: 'GET' })
  return r.data?.data ?? []
}

/** POST /v1/social-posts — create or schedule a post across the given accounts. */
export async function publish(opts: {
  accountIds: string[]
  caption: string
  externalId?: string
  media?: Array<{ url: string }>
  scheduledAt?: string | null
  thread?: string[]   // no native thread field — joined into the caption
}): Promise<{ ok: boolean; postId?: string; status: 'published' | 'scheduled' | 'failed'; error?: string }> {
  const caption = opts.thread?.length ? [opts.caption, ...opts.thread].join('\n\n') : opts.caption
  const body: Record<string, unknown> = { caption, social_accounts: opts.accountIds }
  if (opts.externalId) body.external_id = opts.externalId
  if (opts.media?.length) body.media = opts.media.map((m) => ({ url: m.url }))
  if (opts.scheduledAt) body.scheduled_at = opts.scheduledAt
  const r = await call<{ id?: string; status?: string }>(`/v1/social-posts`, { method: 'POST', body: JSON.stringify(body) })
  if (!r.ok) return { ok: false, status: 'failed', error: r.error }
  const id = r.data?.id ? String(r.data.id) : undefined
  const st = r.data?.status
  return { ok: true, postId: id, status: st === 'scheduled' ? 'scheduled' : 'published' }  // 'processing'/'processed'/'draft' → treat as published
}

/** GET /v1/social-post-results?post_id=… — per-account results; engagement
 *  numbers (when available) live inside each result's `platform_data`. */
export async function getPostMetrics(postId: string): Promise<{ impressions?: number; likes?: number; comments?: number; reposts?: number } | null> {
  const r = await call<{ data?: Array<{ success?: boolean; platform_data?: Record<string, unknown>; details?: Record<string, unknown> }> }>(`/v1/social-post-results?post_id=${encodeURIComponent(postId)}`, { method: 'GET' })
  const rows = r.data?.data ?? []
  if (!r.ok || rows.length === 0) return null
  // Sum whatever recognizable engagement keys appear across per-account results.
  const acc = { impressions: 0, likes: 0, comments: 0, reposts: 0 }
  let found = false
  const pick = (o: Record<string, unknown> | undefined, keys: string[]): number | undefined => {
    if (!o) return undefined
    for (const k of keys) { const v = o[k]; if (typeof v === 'number') return v }
    return undefined
  }
  for (const row of rows) {
    const pd = (row.platform_data ?? row.details) as Record<string, unknown> | undefined
    // platform_data may nest under a metrics/insights/statistics key
    const nest = (pd && (pd.metrics || pd.insights || pd.statistics || pd.public_metrics)) as Record<string, unknown> | undefined
    const src = nest ?? pd
    const imp = pick(src, ['impressions', 'impression_count', 'views', 'view_count', 'reach'])
    const lk = pick(src, ['likes', 'like_count', 'favorites', 'favorite_count', 'reactions', 'reaction_count'])
    const cm = pick(src, ['comments', 'comment_count', 'replies', 'reply_count'])
    const rp = pick(src, ['reposts', 'repost_count', 'shares', 'share_count', 'retweets', 'retweet_count'])
    if (imp != null || lk != null || cm != null || rp != null) found = true
    acc.impressions += imp ?? 0; acc.likes += lk ?? 0; acc.comments += cm ?? 0; acc.reposts += rp ?? 0
  }
  return found ? acc : null
}

/** POST /v1/social-accounts/{id}/disconnect */
export async function disconnectAccount(accountId: string): Promise<boolean> {
  const r = await call(`/v1/social-accounts/${encodeURIComponent(accountId)}/disconnect`, { method: 'POST' })
  return r.ok
}
