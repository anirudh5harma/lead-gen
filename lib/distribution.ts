import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type DistributionProviderId = 'linkedin' | 'x' | 'instagram' | 'tiktok' | 'medium' | 'substack'

export interface DistributionAccount {
  id: string
  user_id: string
  client_id: string | null
  provider: DistributionProviderId
  provider_account_id: string | null
  display_name: string | null
  handle: string | null
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  scopes: string[]
  status: 'connected' | 'needs_reconnect' | 'manual' | 'disabled'
  publish_mode: 'manual_review' | 'scheduled' | 'auto_publish'
  metadata: Record<string, unknown>
}

export interface DistributionProfile {
  providerAccountId: string
  displayName: string
  handle: string | null
  metadata?: Record<string, unknown>
}

export interface DistributionTokenResult {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
  scopes: string[]
  profile: DistributionProfile
}

export interface DistributionPublishInput {
  account: DistributionAccount
  text: string
  title: string
  url?: string | null
  mediaUrl?: string | null
  metadata?: Record<string, unknown>
}

export interface DistributionPublishResult {
  providerPostId: string
  url?: string | null
  status?: string
}

interface ProviderConfig {
  id: DistributionProviderId
  label: string
  category: string
  envPrefix: string | null
  direct: boolean
  supported: string[]
  manualReason?: string
}

interface DistributionAccountSelection {
  id: string
  status: string
  publish_mode: string
}

interface OAuthStatePayload {
  userId: string
  clientId: string | null
  provider: DistributionProviderId
  codeVerifier?: string
  ts: number
}

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? ''
const STATE_TTL_MS = 10 * 60 * 1000

export const DISTRIBUTION_PROVIDERS: ProviderConfig[] = [
  { id: 'linkedin', label: 'LinkedIn', category: 'Social', envPrefix: 'LINKEDIN_DISTRIBUTION', direct: true, supported: ['linkedin_post', 'blog_article'] },
  { id: 'x', label: 'X', category: 'Social', envPrefix: 'X_DISTRIBUTION', direct: true, supported: ['x_post'] },
  { id: 'instagram', label: 'Instagram', category: 'Social', envPrefix: 'META_DISTRIBUTION', direct: true, supported: ['video_script'], manualReason: 'Requires an Instagram Professional account and media asset.' },
  { id: 'tiktok', label: 'TikTok', category: 'Video', envPrefix: 'TIKTOK_DISTRIBUTION', direct: true, supported: ['video_script'], manualReason: 'Requires approved TikTok Content Posting API access and a video asset.' },
  { id: 'medium', label: 'Medium', category: 'Articles', envPrefix: null, direct: false, supported: ['blog_article'], manualReason: 'Medium no longer supports its official publishing API. Bombsell prepares export-ready copy.' },
  { id: 'substack', label: 'Substack', category: 'Newsletter', envPrefix: null, direct: false, supported: ['blog_article', 'newsletter_blurb'], manualReason: 'Substack has no stable public publishing API. Bombsell prepares export-ready Markdown/HTML.' },
]

export function providerConfig(provider: string): ProviderConfig | null {
  return DISTRIBUTION_PROVIDERS.find(item => item.id === provider) ?? null
}

export function isDistributionProvider(value: string): value is DistributionProviderId {
  return Boolean(providerConfig(value))
}

export function distributionProviderForContentType(contentType: string, targetPlatform?: string | null): DistributionProviderId | null {
  if (targetPlatform === 'linkedin') return 'linkedin'
  if (targetPlatform === 'x') return 'x'
  if (targetPlatform === 'instagram') return 'instagram'
  if (targetPlatform === 'tiktok') return 'tiktok'
  if (targetPlatform === 'newsletter' || targetPlatform === 'substack') return 'substack'
  if (targetPlatform === 'blog' || targetPlatform === 'medium') return 'medium'
  if (contentType === 'linkedin_post') return 'linkedin'
  if (contentType === 'x_post') return 'x'
  if (contentType === 'blog_article') return 'medium'
  if (contentType === 'newsletter_blurb') return 'substack'
  if (contentType === 'video_script') return 'tiktok'
  return null
}

export function selectPreferredDistributionAccount(
  accounts: DistributionAccountSelection[],
): DistributionAccountSelection | null {
  if (!Array.isArray(accounts) || accounts.length === 0) return null
  const scored = [...accounts].sort((left, right) => distributionAccountScore(right) - distributionAccountScore(left))
  return scored[0] ?? null
}

export function isPublishModeQueueEligible(mode: string): boolean {
  if (mode === 'scheduled' || mode === 'auto_publish') return true
  if (mode === 'manual_review') return process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW === 'true' ? false : true
  return false
}

export function providerConnectStatus(provider: DistributionProviderId) {
  const config = providerConfig(provider)
  if (!config) return { enabled: false, reason: 'Unknown provider.' }
  if (!config.direct) return { enabled: false, reason: config.manualReason ?? 'Manual export only.' }
  if (provider === 'linkedin') return hasEnv('LINKEDIN_DISTRIBUTION_CLIENT_ID', 'LINKEDIN_DISTRIBUTION_CLIENT_SECRET')
  if (provider === 'x') return hasEnv('X_DISTRIBUTION_CLIENT_ID', 'X_DISTRIBUTION_CLIENT_SECRET')
  if (provider === 'instagram') return hasEnv('META_DISTRIBUTION_CLIENT_ID', 'META_DISTRIBUTION_CLIENT_SECRET')
  if (provider === 'tiktok') return hasEnv('TIKTOK_DISTRIBUTION_CLIENT_KEY', 'TIKTOK_DISTRIBUTION_CLIENT_SECRET')
  return { enabled: false, reason: 'Manual export only.' }
}

function hasEnv(clientKey: string, secretKey: string) {
  if (process.env[clientKey] && process.env[secretKey]) return { enabled: true, reason: null }
  return { enabled: false, reason: `Set ${clientKey} and ${secretKey}.` }
}

export function createDistributionOAuthState(input: {
  userId: string
  clientId: string | null
  provider: DistributionProviderId
  codeVerifier?: string
}): string {
  const payload = Buffer.from(JSON.stringify({ ...input, ts: Date.now() })).toString('base64url')
  return `${payload}.${signState(payload)}`
}

export function verifyDistributionOAuthState(state: string): OAuthStatePayload | null {
  const [payload, signature] = state.split('.')
  if (!payload || !signature || !safeEqual(signature, signState(payload))) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OAuthStatePayload
    if (!decoded.userId || !decoded.provider || Date.now() - decoded.ts > STATE_TTL_MS) return null
    return decoded
  } catch {
    return null
  }
}

export function randomCodeVerifier(): string {
  return randomBytes(48).toString('base64url')
}

export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function distributionAuthUrl(input: {
  provider: DistributionProviderId
  state: string
  codeChallenge?: string
}): string {
  const redirectUri = distributionRedirectUri(input.provider)
  if (input.provider === 'linkedin') {
    return withParams('https://www.linkedin.com/oauth/v2/authorization', {
      response_type: 'code',
      client_id: process.env.LINKEDIN_DISTRIBUTION_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      state: input.state,
      scope: process.env.LINKEDIN_DISTRIBUTION_SCOPES ?? 'openid profile w_member_social',
    })
  }
  if (input.provider === 'x') {
    return withParams('https://x.com/i/oauth2/authorize', {
      response_type: 'code',
      client_id: process.env.X_DISTRIBUTION_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      state: input.state,
      scope: process.env.X_DISTRIBUTION_SCOPES ?? 'tweet.read tweet.write users.read offline.access',
      code_challenge: input.codeChallenge ?? '',
      code_challenge_method: 'S256',
    })
  }
  if (input.provider === 'instagram') {
    return withParams('https://www.facebook.com/v20.0/dialog/oauth', {
      response_type: 'code',
      client_id: process.env.META_DISTRIBUTION_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      state: input.state,
      scope: process.env.META_DISTRIBUTION_SCOPES ?? 'pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish',
    })
  }
  if (input.provider === 'tiktok') {
    return withParams('https://www.tiktok.com/v2/auth/authorize/', {
      response_type: 'code',
      client_key: process.env.TIKTOK_DISTRIBUTION_CLIENT_KEY ?? '',
      redirect_uri: redirectUri,
      state: input.state,
      scope: process.env.TIKTOK_DISTRIBUTION_SCOPES ?? 'user.info.basic,video.publish',
    })
  }
  throw new Error(`${input.provider} does not support OAuth connect.`)
}

export async function exchangeDistributionCode(provider: DistributionProviderId, code: string, codeVerifier?: string): Promise<DistributionTokenResult> {
  if (provider === 'linkedin') return exchangeLinkedInCode(code)
  if (provider === 'x') return exchangeXCode(code, codeVerifier)
  if (provider === 'instagram') return exchangeInstagramCode(code)
  if (provider === 'tiktok') return exchangeTikTokCode(code)
  throw new Error(`${provider} does not support OAuth connect.`)
}

export async function refreshDistributionAccount(account: DistributionAccount, supabase: SupabaseClient): Promise<DistributionAccount> {
  if (!account.refresh_token || !account.token_expires_at) return account
  if (new Date(account.token_expires_at).getTime() - Date.now() > 5 * 60 * 1000) return account
  let refreshed: { accessToken: string; refreshToken?: string | null; expiresIn: number | null } | null = null
  if (account.provider === 'x') refreshed = await refreshXToken(account.refresh_token)
  if (account.provider === 'tiktok') refreshed = await refreshTikTokToken(account.refresh_token)
  if (!refreshed) return account
  const token_expires_at = refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() : account.token_expires_at
  const refresh_token = refreshed.refreshToken ?? account.refresh_token
  await supabase.from('connected_distribution_accounts').update({
    access_token: refreshed.accessToken,
    refresh_token,
    token_expires_at,
    status: 'connected',
  }).eq('id', account.id)
  return { ...account, access_token: refreshed.accessToken, refresh_token, token_expires_at, status: 'connected' }
}

export async function publishToDistributionProvider(input: DistributionPublishInput): Promise<DistributionPublishResult> {
  const account = input.account
  if (!account.access_token) throw new Error('Distribution account has no access token.')
  if (account.provider === 'linkedin') return publishLinkedIn(input)
  if (account.provider === 'x') return publishX(input)
  if (account.provider === 'instagram') return publishInstagram(input)
  if (account.provider === 'tiktok') return publishTikTok(input)
  throw new Error(`${account.provider} is manual export only.`)
}

export async function enqueueDistributionJobForIdea(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null; ideaId: string; contentType: string; scheduledFor: string | null; targetPlatform?: string | null },
): Promise<void> {
  if (!input.scheduledFor) {
    await supabase
      .from('content_distribution_jobs')
      .update({ status: 'cancelled', scheduled_for: null, error_message: null })
      .eq('content_idea_id', input.ideaId)
      .in('status', ['queued', 'failed', 'publishing', 'manual_ready'])
    return
  }
  const provider = distributionProviderForContentType(input.contentType, input.targetPlatform)
  if (!provider) return

  await supabase
    .from('content_distribution_jobs')
    .update({ status: 'cancelled', scheduled_for: null, error_message: 'Cancelled because target platform changed.' })
    .eq('content_idea_id', input.ideaId)
    .neq('provider', provider)
    .in('status', ['queued', 'failed', 'publishing', 'manual_ready'])

  let accountQuery = supabase
    .from('connected_distribution_accounts')
    .select('id, status, publish_mode')
    .eq('user_id', input.userId)
    .eq('provider', provider)
    .neq('status', 'disabled')
    .order('created_at', { ascending: true })
    .limit(20)
  accountQuery = input.clientId ? accountQuery.eq('client_id', input.clientId) : accountQuery.is('client_id', null)
  const { data: accountRows } = await accountQuery
  const account = selectPreferredDistributionAccount(
    ((accountRows ?? []) as Array<Record<string, unknown>>).map(row => ({
      id: stringValue(row.id),
      status: stringValue(row.status),
      publish_mode: stringValue(row.publish_mode),
    })).filter(row => row.id),
  )

  const config = providerConfig(provider)
  const status = config?.direct && account?.id && account.status === 'connected' && isPublishModeQueueEligible(account.publish_mode)
    ? 'queued'
    : 'manual_ready'
  const { data: existingJob } = await supabase
    .from('content_distribution_jobs')
    .select('id')
    .eq('content_idea_id', input.ideaId)
    .eq('provider', provider)
    .maybeSingle()

  const row = {
    user_id: input.userId,
    client_id: input.clientId,
    content_idea_id: input.ideaId,
    connected_distribution_account_id: account?.id ?? null,
    provider,
    status,
    scheduled_for: input.scheduledFor,
    payload: { source: 'content_hub_schedule', manual_reason: config?.manualReason ?? null },
    error_message: null,
  }
  const { error } = existingJob?.id
    ? await supabase.from('content_distribution_jobs').update(row).eq('id', existingJob.id)
    : await supabase.from('content_distribution_jobs').insert(row)
  if (error) console.error('[distribution] enqueue failed:', error.message)
}

export async function publishDueDistributionJobs(
  supabase: SupabaseClient,
  nowIso = new Date().toISOString(),
): Promise<{ published: number; failed: number; skipped: number }> {
  const { data: jobs, error } = await supabase
    .from('content_distribution_jobs')
    .select('id, user_id, client_id, content_idea_id, connected_distribution_account_id, provider, scheduled_for, attempt_count')
    .in('status', ['queued', 'failed'])
    .lte('scheduled_for', nowIso)
    .lt('attempt_count', 3)
    .order('scheduled_for', { ascending: true })
    .limit(20)
  if (error) throw new Error(error.message)

  let published = 0
  let failed = 0
  let skipped = 0

  for (const job of (jobs ?? []) as Array<Record<string, unknown>>) {
    const jobId = stringValue(job.id)
    const accountId = stringValue(job.connected_distribution_account_id)
    const ideaId = stringValue(job.content_idea_id)
    if (!jobId) {
      skipped++
      continue
    }
    if (!accountId || !ideaId) {
      skipped++
      await supabase
        .from('content_distribution_jobs')
        .update({
          status: 'cancelled',
          error_message: 'Distribution job missing required references. Reschedule from Content Hub.',
        })
        .eq('id', jobId)
      continue
    }

    await supabase.from('content_distribution_jobs').update({ status: 'publishing', attempt_count: Number(job.attempt_count ?? 0) + 1 }).eq('id', jobId)
    try {
      const [{ data: account }, { data: idea }] = await Promise.all([
        supabase.from('connected_distribution_accounts').select('*').eq('id', accountId).maybeSingle(),
        supabase.from('gtm_content_ideas').select('id, angle, content_type, draft, proof_points, source_assets, media_assets, compliance_flags').eq('id', ideaId).maybeSingle(),
      ])
      if (!account || !idea) {
        skipped++
        await supabase
          .from('content_distribution_jobs')
          .update({
            status: 'cancelled',
            error_message: 'Distribution account or content idea no longer exists.',
          })
          .eq('id', jobId)
        continue
      }
      const refreshed = await refreshDistributionAccount(account as DistributionAccount, supabase)
      const draft = normalizeRecord((idea as Record<string, unknown>).draft)
      const sourceAssets = normalizeProofPoints((idea as Record<string, unknown>).source_assets)
      const mediaAssets = normalizeProofPoints((idea as Record<string, unknown>).media_assets)
      const result = await publishToDistributionProvider({
        account: refreshed,
        title: stringValue(draft.title) || stringValue((idea as Record<string, unknown>).angle),
        text: stringValue(draft.body) || stringValue((idea as Record<string, unknown>).angle),
        mediaUrl: [...mediaAssets, ...sourceAssets].find(asset => /^https?:\/\//i.test(asset.value))?.value ?? null,
        metadata: { content_idea_id: ideaId, compliance_flags: normalizeRecord((idea as Record<string, unknown>).compliance_flags) },
      })
      await supabase.from('content_distribution_jobs').update({
        status: 'published',
        published_at: new Date().toISOString(),
        provider_post_id: result.providerPostId,
        payload: { result },
        error_message: null,
      }).eq('id', jobId)
      await supabase.from('connected_distribution_accounts').update({ last_publish_at: new Date().toISOString() }).eq('id', accountId)
      await supabase.from('gtm_content_ideas').update({ published_at: new Date().toISOString() }).eq('id', ideaId)
      published++
    } catch (publishError) {
      failed++
      await supabase.from('content_distribution_jobs').update({
        status: 'failed',
        error_message: publishError instanceof Error ? publishError.message.slice(0, 500) : 'Publish failed',
      }).eq('id', jobId)
    }
  }

  return { published, failed, skipped }
}

function distributionRedirectUri(provider: DistributionProviderId): string {
  return `${BASE}/api/distribution/auth/${provider}/callback`
}

async function exchangeLinkedInCode(code: string): Promise<DistributionTokenResult> {
  const token = await formPost('https://www.linkedin.com/oauth/v2/accessToken', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: distributionRedirectUri('linkedin'),
    client_id: process.env.LINKEDIN_DISTRIBUTION_CLIENT_ID ?? '',
    client_secret: process.env.LINKEDIN_DISTRIBUTION_CLIENT_SECRET ?? '',
  })
  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  const profile = await profileRes.json() as Record<string, unknown>
  if (!profileRes.ok) throw new Error(stringValue(profile.message) || 'LinkedIn profile lookup failed')
  const sub = stringValue(profile.sub)
  return {
    accessToken: stringValue(token.access_token),
    refreshToken: stringValue(token.refresh_token) || null,
    expiresIn: Number(token.expires_in) || null,
    scopes: stringArrayFromScope(token.scope),
    profile: {
      providerAccountId: sub,
      displayName: stringValue(profile.name) || 'LinkedIn account',
      handle: null,
      metadata: { author_urn: sub ? `urn:li:person:${sub}` : null, picture: stringValue(profile.picture) || null },
    },
  }
}

async function exchangeXCode(code: string, codeVerifier?: string): Promise<DistributionTokenResult> {
  const token = await formPost('https://api.x.com/2/oauth2/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: distributionRedirectUri('x'),
    client_id: process.env.X_DISTRIBUTION_CLIENT_ID ?? '',
    client_secret: process.env.X_DISTRIBUTION_CLIENT_SECRET ?? '',
    code_verifier: codeVerifier ?? '',
  })
  const profileRes = await fetch('https://api.x.com/2/users/me?user.fields=username,name,profile_image_url', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  const profile = await profileRes.json() as { data?: Record<string, unknown>; errors?: unknown }
  if (!profileRes.ok) throw new Error('X profile lookup failed')
  const data = profile.data ?? {}
  return {
    accessToken: stringValue(token.access_token),
    refreshToken: stringValue(token.refresh_token) || null,
    expiresIn: Number(token.expires_in) || null,
    scopes: stringArrayFromScope(token.scope),
    profile: {
      providerAccountId: stringValue(data.id),
      displayName: stringValue(data.name) || stringValue(data.username) || 'X account',
      handle: stringValue(data.username) ? `@${stringValue(data.username)}` : null,
      metadata: { profile_image_url: stringValue(data.profile_image_url) || null },
    },
  }
}

async function exchangeInstagramCode(code: string): Promise<DistributionTokenResult> {
  const token = await formPost('https://graph.facebook.com/v20.0/oauth/access_token', {
    client_id: process.env.META_DISTRIBUTION_CLIENT_ID ?? '',
    client_secret: process.env.META_DISTRIBUTION_CLIENT_SECRET ?? '',
    redirect_uri: distributionRedirectUri('instagram'),
    code,
  })
  const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(stringValue(token.access_token))}`)
  const pages = await pagesRes.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string } }
  if (!pagesRes.ok) throw new Error(pages.error?.message || 'Instagram account lookup failed')
  const page = (pages.data ?? []).find(item => normalizeRecord(item.instagram_business_account).id)
  const ig = normalizeRecord(page?.instagram_business_account)
  if (!ig.id) throw new Error('No Instagram Professional account is connected to the authorized Meta page.')
  return {
    accessToken: stringValue(token.access_token),
    refreshToken: null,
    expiresIn: Number(token.expires_in) || null,
    scopes: [],
    profile: {
      providerAccountId: stringValue(ig.id),
      displayName: stringValue(ig.name) || stringValue(page?.name) || 'Instagram account',
      handle: stringValue(ig.username) ? `@${stringValue(ig.username)}` : null,
      metadata: { page_id: stringValue(page?.id), page_name: stringValue(page?.name) },
    },
  }
}

async function exchangeTikTokCode(code: string): Promise<DistributionTokenResult> {
  const token = await formPost('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.TIKTOK_DISTRIBUTION_CLIENT_KEY ?? '',
    client_secret: process.env.TIKTOK_DISTRIBUTION_CLIENT_SECRET ?? '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: distributionRedirectUri('tiktok'),
  })
  const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  const profile = await profileRes.json() as { data?: { user?: Record<string, unknown> }; error?: { message?: string } }
  if (!profileRes.ok) throw new Error(profile.error?.message || 'TikTok profile lookup failed')
  const user = profile.data?.user ?? {}
  return {
    accessToken: stringValue(token.access_token),
    refreshToken: stringValue(token.refresh_token) || null,
    expiresIn: Number(token.expires_in) || null,
    scopes: stringArrayFromScope(token.scope),
    profile: {
      providerAccountId: stringValue(user.open_id),
      displayName: stringValue(user.display_name) || 'TikTok account',
      handle: null,
      metadata: { avatar_url: stringValue(user.avatar_url) || null, union_id: stringValue(user.union_id) || null },
    },
  }
}

async function refreshXToken(refreshToken: string) {
  const token = await formPost('https://api.x.com/2/oauth2/token', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.X_DISTRIBUTION_CLIENT_ID ?? '',
    client_secret: process.env.X_DISTRIBUTION_CLIENT_SECRET ?? '',
  })
  return { accessToken: stringValue(token.access_token), refreshToken: stringValue(token.refresh_token) || null, expiresIn: Number(token.expires_in) || null }
}

async function refreshTikTokToken(refreshToken: string) {
  const token = await formPost('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.TIKTOK_DISTRIBUTION_CLIENT_KEY ?? '',
    client_secret: process.env.TIKTOK_DISTRIBUTION_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  return { accessToken: stringValue(token.access_token), refreshToken: stringValue(token.refresh_token) || null, expiresIn: Number(token.expires_in) || null }
}

async function publishLinkedIn(input: DistributionPublishInput): Promise<DistributionPublishResult> {
  const author = stringValue(input.account.metadata.author_urn)
  if (!author) throw new Error('LinkedIn author URN is missing. Reconnect LinkedIn.')
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.account.access_token}`,
      'Content-Type': 'application/json',
      'Linkedin-Version': process.env.LINKEDIN_DISTRIBUTION_VERSION ?? '202604',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author,
      commentary: input.text.slice(0, 2900),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`LinkedIn publish failed: ${body.slice(0, 240)}`)
  return { providerPostId: res.headers.get('x-restli-id') ?? createHash('sha1').update(body || input.text).digest('hex') }
}

async function publishX(input: DistributionPublishInput): Promise<DistributionPublishResult> {
  const res = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.account.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: input.text.slice(0, 280) }),
  })
  const body = await res.json().catch(() => null) as { data?: { id?: string }; detail?: string; title?: string }
  if (!res.ok) throw new Error(body?.detail || body?.title || 'X publish failed')
  return { providerPostId: body.data?.id ?? createHash('sha1').update(input.text).digest('hex') }
}

async function publishInstagram(input: DistributionPublishInput): Promise<DistributionPublishResult> {
  if (!input.mediaUrl) throw new Error('Instagram publishing requires a public image/video URL in source assets.')
  const igId = input.account.provider_account_id
  const token = input.account.access_token ?? ''
  const mediaParams: Record<string, string> = /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(input.mediaUrl)
    ? { media_type: 'REELS', video_url: input.mediaUrl, caption: input.text.slice(0, 2200), access_token: token }
    : { image_url: input.mediaUrl, caption: input.text.slice(0, 2200), access_token: token }
  const media = await fetch(`https://graph.facebook.com/v20.0/${igId}/media`, {
    method: 'POST',
    body: new URLSearchParams(mediaParams),
  }).then(res => res.json() as Promise<{ id?: string; error?: { message?: string } }>)
  if (!media.id) throw new Error(media.error?.message || 'Instagram media container creation failed')
  const publish = await fetch(`https://graph.facebook.com/v20.0/${igId}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: media.id, access_token: token }),
  }).then(res => res.json() as Promise<{ id?: string; error?: { message?: string } }>)
  if (!publish.id) throw new Error(publish.error?.message || 'Instagram publish failed')
  return { providerPostId: publish.id }
}

async function publishTikTok(input: DistributionPublishInput): Promise<DistributionPublishResult> {
  if (!input.mediaUrl) throw new Error('TikTok publishing requires a public video URL in source assets.')
  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.account.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: input.text.slice(0, 2200),
        privacy_level: 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        is_aigc: normalizeRecord(input.metadata).compliance_flags ? Boolean(normalizeRecord(normalizeRecord(input.metadata).compliance_flags).requires_ai_label) : false,
      },
      source_info: { source: 'PULL_FROM_URL', video_url: input.mediaUrl },
    }),
  })
  const body = await res.json().catch(() => null) as { data?: { publish_id?: string }; error?: { message?: string; code?: string } }
  if (!res.ok || !body.data?.publish_id) throw new Error(body.error?.message || body.error?.code || 'TikTok publish initialization failed')
  return { providerPostId: body.data.publish_id, status: 'processing' }
}

async function formPost(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const data = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !data) throw new Error(stringValue(data?.error_description) || stringValue(data?.error) || `${url} failed`)
  return data
}

function withParams(url: string, params: Record<string, string>) {
  const search = new URLSearchParams(params)
  return `${url}?${search}`
}

function signState(payload: string): string {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.CRON_SECRET
  if (!secret) throw new Error('OAUTH_STATE_SECRET or CRON_SECRET must be configured')
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArrayFromScope(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string') return value.split(/[,\s]+/).map(item => item.trim()).filter(Boolean)
  return []
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function normalizeProofPoints(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map(item => normalizeRecord(item))
    .map(item => ({ label: stringValue(item.label), value: stringValue(item.value) }))
    .filter(item => item.label && item.value)
}

function distributionAccountScore(account: DistributionAccountSelection): number {
  let score = 0
  if (account.status === 'connected') score += 100
  else if (account.status === 'needs_reconnect') score += 30
  if (account.publish_mode === 'scheduled' || account.publish_mode === 'auto_publish') score += 20
  else if (isPublishModeQueueEligible(account.publish_mode)) score += 5
  else if (account.publish_mode === 'manual_review') score -= 10
  return score
}
