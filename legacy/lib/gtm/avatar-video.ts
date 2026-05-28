import type { SupabaseClient } from '@supabase/supabase-js'
import { VIDEO_SCRIPT_MAX_CHARS, VIDEO_SCRIPT_MAX_SECONDS, VIDEO_SCRIPT_MAX_WORDS } from '@/lib/gtm/content-planning'
export interface AvatarVideoJobResult {
  id: string
  status: 'manual_ready' | 'queued' | 'rendering' | 'ready' | 'failed'
  provider: string
  video_url: string | null
  thumbnail_url: string | null
}

export class AvatarVideoError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'AvatarVideoError'
    this.statusCode = statusCode
  }
}

interface ProviderRenderResult {
  provider: string
  status: AvatarVideoJobResult['status']
  videoUrl: string | null
  thumbnailUrl: string | null
  providerJobId: string | null
  errorMessage?: string | null
}

interface ProviderStatusResult {
  status: AvatarVideoJobResult['status']
  videoUrl: string | null
  thumbnailUrl: string | null
  errorMessage: string | null
}

export async function createAvatarVideoJob(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    ideaId: string
    settings?: Record<string, unknown> | null
    creditReserved?: boolean
  },
): Promise<AvatarVideoJobResult> {
  let ideaQuery = supabase
    .from('gtm_content_ideas')
    .select('id, content_type, angle, draft, final_body, source_insights, media_assets, draft_settings')
    .eq('id', input.ideaId)
    .eq('user_id', input.userId)
  ideaQuery = input.clientId ? ideaQuery.eq('client_id', input.clientId) : ideaQuery.is('client_id', null)
  const { data: idea, error } = await ideaQuery.maybeSingle()
  if (error) throw new AvatarVideoError(error.message, 500)
  if (!idea) throw new AvatarVideoError('Content idea not found', 404)
  if ((idea as { content_type?: string }).content_type !== 'video_script') throw new AvatarVideoError('Avatar video generation requires a video content item.', 400)

  const draft = normalizeRecord((idea as Record<string, unknown>).draft)
  const script = normalizeAvatarSpokenScript(stringValue((idea as Record<string, unknown>).final_body) || stringValue(draft.body) || stringValue((idea as Record<string, unknown>).angle))
  if (script.length < 12) throw new AvatarVideoError('Draft the video script before preparing an avatar video.', 400)
  const caption = extractCaption(script)
  const settings = { ...normalizeRecord((idea as Record<string, unknown>).draft_settings), ...normalizeRecord(input.settings) }
  const providerResult = await requestProviderRender({
    script,
    caption,
    title: stringValue(draft.title) || stringValue((idea as Record<string, unknown>).angle),
    settings,
    metadata: { content_idea_id: input.ideaId },
  })

  const { data: job, error: insertError } = await supabase
    .from('gtm_avatar_video_jobs')
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      content_idea_id: input.ideaId,
      provider: providerResult.provider,
      status: providerResult.status,
      script,
      caption,
      video_url: providerResult.videoUrl,
      thumbnail_url: providerResult.thumbnailUrl,
      provider_job_id: providerResult.providerJobId,
      error_message: providerResult.errorMessage ?? null,
      metadata: {
        settings,
        ai_avatar: true,
        inspiration_only: true,
        credit_reserved: input.creditReserved === true,
        credit_refunded: false,
      },
    })
    .select('id, status, provider, video_url, thumbnail_url')
    .single()
  if (insertError) throw new AvatarVideoError(insertError.message, 500)

  if (providerResult.videoUrl) {
    await appendAvatarVideoAsset(supabase, input.ideaId, input.userId, (idea as Record<string, unknown>).media_assets, providerResult.videoUrl)
  }

  return {
    id: stringValue((job as Record<string, unknown>).id),
    status: statusValue((job as Record<string, unknown>).status),
    provider: stringValue((job as Record<string, unknown>).provider) || providerResult.provider,
    video_url: stringValue((job as Record<string, unknown>).video_url) || null,
    thumbnail_url: stringValue((job as Record<string, unknown>).thumbnail_url) || null,
  }
}

export async function pollAvatarVideoJobs(
  supabase: SupabaseClient,
  limit = 20,
): Promise<{ checked: number; ready: number; failed: number; skipped: number }> {
  const { data, error } = await supabase
    .from('gtm_avatar_video_jobs')
    .select('id, user_id, content_idea_id, provider, provider_job_id, status, video_url, thumbnail_url, metadata')
    .in('status', ['queued', 'rendering'])
    .order('updated_at', { ascending: true })
    .limit(Math.max(1, Math.min(50, limit)))
  if (error) throw new AvatarVideoError(error.message, 500)

  let checked = 0
  let ready = 0
  let failed = 0
  let skipped = 0
  for (const job of (data ?? []) as Array<Record<string, unknown>>) {
    const jobId = stringValue(job.id)
    const providerJobId = stringValue(job.provider_job_id)
    if (!jobId || !providerJobId) {
      skipped++
      continue
    }
    checked++
    try {
      const status = await requestProviderStatus(stringValue(job.provider), providerJobId)
      const update = {
        status: status.status,
        video_url: status.videoUrl,
        thumbnail_url: status.thumbnailUrl,
        error_message: status.errorMessage,
      }
      await supabase.from('gtm_avatar_video_jobs').update(update).eq('id', jobId)
      if (status.status === 'ready' && status.videoUrl) {
        const { data: idea } = await supabase.from('gtm_content_ideas').select('media_assets').eq('id', stringValue(job.content_idea_id)).maybeSingle()
        await appendAvatarVideoAsset(supabase, stringValue(job.content_idea_id), stringValue(job.user_id), (idea as Record<string, unknown> | null)?.media_assets, status.videoUrl)
        ready++
      } else if (status.status === 'failed') {
        failed++
        await refundAvatarVideoCreditIfNeeded(supabase, job, jobId, 'provider_failed')
      }
    } catch (error) {
      failed++
      await refundAvatarVideoCreditIfNeeded(supabase, job, jobId, 'status_check_failed')
      await supabase
        .from('gtm_avatar_video_jobs')
        .update({ status: 'failed', error_message: error instanceof Error ? error.message.slice(0, 500) : 'Avatar video status check failed' })
        .eq('id', jobId)
    }
  }

  return { checked, ready, failed, skipped }
}

export async function handleHeyGenWebhookEvent(
  supabase: SupabaseClient,
  payload: unknown,
): Promise<{ handled: boolean; status?: AvatarVideoJobResult['status']; jobId?: string }> {
  const root = normalizeRecord(payload)
  const eventType = stringValue(root.event_type ?? root.type)
  const eventData = normalizeRecord(root.event_data ?? root.data)
  if (!/^avatar_video\.(success|fail)$|^video_agent\.(success|fail)$/i.test(eventType)) {
    return { handled: false }
  }

  const providerJobId = stringValue(eventData.video_id ?? eventData.video_agent_id ?? eventData.session_id ?? eventData.id ?? eventData.job_id ?? eventData.task_id)
  const callbackId = stringValue(eventData.callback_id)
  const job = await findAvatarVideoJobForWebhook(supabase, providerJobId, callbackId)
  if (!job) return { handled: false }

  const jobId = stringValue(job.id)
  const isSuccess = /\.success$/i.test(eventType)
  if (isSuccess) {
    const videoUrl = stringValue(eventData.url ?? eventData.video_url ?? eventData.video_download_url ?? eventData.download_url ?? eventData.video_share_page_url)
    const thumbnailUrl = stringValue(eventData.thumbnail_url ?? eventData.gif_download_url)
    await supabase
      .from('gtm_avatar_video_jobs')
      .update({
        status: 'ready',
        video_url: videoUrl || stringValue(job.video_url) || null,
        thumbnail_url: thumbnailUrl || stringValue(job.thumbnail_url) || null,
        error_message: null,
        metadata: {
          ...normalizeRecord(job.metadata),
          webhook_event_type: eventType,
          webhook_received_at: new Date().toISOString(),
        },
      })
      .eq('id', jobId)
    if (videoUrl) {
      const { data: idea } = await supabase.from('gtm_content_ideas').select('media_assets').eq('id', stringValue(job.content_idea_id)).maybeSingle()
      await appendAvatarVideoAsset(supabase, stringValue(job.content_idea_id), stringValue(job.user_id), (idea as Record<string, unknown> | null)?.media_assets, videoUrl)
    }
    return { handled: true, status: 'ready', jobId }
  }

  await refundAvatarVideoCreditIfNeeded(supabase, job, jobId, 'provider_webhook_failed')
  await supabase
    .from('gtm_avatar_video_jobs')
    .update({
      status: 'failed',
      error_message: (stringValue(eventData.msg ?? eventData.message ?? eventData.error) || 'HeyGen avatar video render failed.').slice(0, 500),
    })
    .eq('id', jobId)
  return { handled: true, status: 'failed', jobId }
}

async function findAvatarVideoJobForWebhook(
  supabase: SupabaseClient,
  providerJobId: string,
  callbackId: string,
): Promise<Record<string, unknown> | null> {
  const select = 'id, user_id, content_idea_id, provider_job_id, status, video_url, thumbnail_url, metadata'
  if (providerJobId) {
    const { data, error } = await supabase
      .from('gtm_avatar_video_jobs')
      .select(select)
      .eq('provider', 'heygen')
      .eq('provider_job_id', providerJobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data) return data as Record<string, unknown>
  }
  if (callbackId && /^[0-9a-f-]{36}$/i.test(callbackId)) {
    const { data, error } = await supabase
      .from('gtm_avatar_video_jobs')
      .select(select)
      .eq('provider', 'heygen')
      .eq('content_idea_id', callbackId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data) return data as Record<string, unknown>
  }
  return null
}

async function refundAvatarVideoCreditIfNeeded(
  supabase: SupabaseClient,
  job: Record<string, unknown>,
  jobId: string,
  reason: string,
): Promise<void> {
  const metadata = normalizeRecord(job.metadata)
  if (metadata.credit_reserved !== true || metadata.credit_refunded === true) return
  try {
    const { error } = await supabase.rpc('add_lead_credits', {
      p_user_id: stringValue(job.user_id),
      p_credits: 1,
      p_external_id: `avatar-video-refund:${jobId}`,
      p_reason: 'refund',
      p_metadata: {
        source: 'avatar_video_generation',
        content_idea_id: stringValue(job.content_idea_id),
        avatar_job_id: jobId,
        status: 'refunded',
        reason,
      },
    })
    if (error) throw new AvatarVideoError(error.message, 500)
    await supabase
      .from('gtm_avatar_video_jobs')
      .update({ metadata: { ...metadata, credit_refunded: true, credit_refund_reason: reason } })
      .eq('id', jobId)
  } catch (error) {
    console.error('[avatar-video] credit refund failed:', error instanceof Error ? error.message : error)
  }
}

async function requestProviderRender(input: {
  script: string
  caption: string
  title: string
  settings: Record<string, unknown>
  metadata: Record<string, unknown>
}): Promise<ProviderRenderResult> {
  const config = resolveProviderConfig()
  if (!config.apiKey && !config.endpoint) {
    return { provider: 'manual_ready', status: 'manual_ready', videoUrl: null, thumbnailUrl: null, providerJobId: null, errorMessage: 'Set HEYGEN_API_KEY to enable avatar video rendering.' }
  }
  if (config.provider === 'heygen') return requestHeyGenRender(input, config)
  return requestGenericRender(input, config)
}

async function requestHeyGenRender(input: {
  script: string
  caption: string
  title: string
  settings: Record<string, unknown>
  metadata: Record<string, unknown>
}, config: ResolvedProviderConfig): Promise<ProviderRenderResult> {
  if (!config.apiKey) {
    return { provider: 'heygen', status: 'manual_ready', videoUrl: null, thumbnailUrl: null, providerJobId: null, errorMessage: 'Set HEYGEN_API_KEY to enable HeyGen avatar video rendering.' }
  }
  const prompt = [
    `Create a polished, business-safe avatar-led vertical video titled "${input.title}".`,
    `Hard duration limit: ${VIDEO_SCRIPT_MAX_SECONDS} seconds. Use only this concise spoken script, do not expand it.`,
    `Script:\n${input.script.slice(0, VIDEO_SCRIPT_MAX_CHARS)}`,
    input.caption ? `Caption:\n${input.caption}` : '',
    'Use an original presenter-style execution. Do not copy source creator footage or imply endorsement by the original creator.',
  ].filter(Boolean).join('\n\n')
  const callbackId = stringValue(input.metadata.content_idea_id)
  const body: Record<string, unknown> = { prompt, callback_id: callbackId }
  const callbackUrl = heyGenCallbackUrl()
  if (callbackUrl) body.callback_url = callbackUrl
  const avatarId = stringValue(input.settings.avatarId ?? input.settings.avatar_id) || process.env.HEYGEN_AVATAR_ID
  const voiceId = stringValue(input.settings.voiceId ?? input.settings.voice_id) || process.env.HEYGEN_VOICE_ID
  if (/\/v1\/video_agent\/generate/i.test(config.endpoint)) {
    const configPayload: Record<string, unknown> = {}
    if (avatarId) configPayload.avatar_id = avatarId
    if (voiceId) configPayload.voice_id = voiceId
    if (Object.keys(configPayload).length > 0) body.config = configPayload
  } else {
    if (avatarId) body.avatar_id = avatarId
    if (voiceId) body.voice_id = voiceId
  }

  const res = await fetch(config.endpoint || 'https://api.heygen.com/v3/video-agents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const data = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !data) {
    throw new AvatarVideoError(providerError(data) || `HeyGen render failed with ${res.status}`, res.status >= 400 && res.status < 500 ? 400 : 502)
  }
  const nested = normalizeRecord(data.data)
  const payload = Object.keys(nested).length > 0 ? nested : data
  const providerJobId = stringValue(payload.video_id) || stringValue(payload.video_agent_id) || stringValue(payload.session_id) || stringValue(payload.id) || stringValue(payload.job_id) || stringValue(payload.task_id)
  if (!providerJobId && !stringValue(payload.video_url) && !stringValue(payload.url)) {
    throw new AvatarVideoError('HeyGen did not return a video id. Check the configured endpoint and API plan permissions.', 502)
  }
  return {
    provider: 'heygen',
    status: stringValue(payload.video_url) ? 'ready' : 'queued',
    videoUrl: stringValue(payload.video_url) || stringValue(payload.url) || null,
    thumbnailUrl: stringValue(payload.thumbnail_url) || null,
    providerJobId,
  }
}

async function requestGenericRender(input: {
  script: string
  caption: string
  title: string
  settings: Record<string, unknown>
  metadata: Record<string, unknown>
}, config: ResolvedProviderConfig): Promise<ProviderRenderResult> {
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000),
  })
  const data = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !data) {
    throw new AvatarVideoError(providerError(data) || `Avatar video provider failed with ${res.status}`, res.status >= 400 && res.status < 500 ? 400 : 502)
  }
  return {
    provider: stringValue(data.provider) || 'avatar_provider',
    status: stringValue(data.video_url) ? 'ready' : 'queued',
    videoUrl: stringValue(data.video_url) || null,
    thumbnailUrl: stringValue(data.thumbnail_url) || null,
    providerJobId: stringValue(data.job_id) || null,
  }
}

async function requestProviderStatus(provider: string, providerJobId: string): Promise<ProviderStatusResult> {
  if (provider === 'heygen') return requestHeyGenStatus(providerJobId)
  const statusUrl = process.env.AVATAR_VIDEO_STATUS_URL
  const apiKey = process.env.AVATAR_VIDEO_API_KEY
  if (!statusUrl) return { status: 'queued', videoUrl: null, thumbnailUrl: null, errorMessage: null }
  const res = await fetch(statusUrl.replace('{job_id}', encodeURIComponent(providerJobId)), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !data) throw new AvatarVideoError(providerError(data) || `Avatar video status failed with ${res.status}`, 502)
  return normalizeProviderStatus(data)
}

async function requestHeyGenStatus(providerJobId: string): Promise<ProviderStatusResult> {
  const config = resolveProviderConfig()
  if (!config.apiKey) throw new AvatarVideoError('Set HEYGEN_API_KEY to poll HeyGen avatar jobs.', 500)
  const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(providerJobId)}`, {
    headers: { 'x-api-key': config.apiKey },
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !data) throw new AvatarVideoError(providerError(data) || `HeyGen status failed with ${res.status}`, 502)
  const nested = normalizeRecord(data.data)
  return normalizeProviderStatus(Object.keys(nested).length > 0 ? nested : data)
}

function normalizeProviderStatus(data: Record<string, unknown>): ProviderStatusResult {
  const status = stringValue(data.status).toLowerCase()
  const errorMessage = providerError(data)
  const videoUrl = stringValue(data.video_url) || stringValue(data.url) || stringValue(data.video_download_url) || stringValue(data.download_url) || stringValue(data.video_share_page_url)
  const thumbnailUrl = stringValue(data.thumbnail_url) || stringValue(data.gif_download_url) || null
  if (status === 'completed' || status === 'complete' || status === 'ready' || status === 'success' || videoUrl) {
    return { status: 'ready', videoUrl: videoUrl || null, thumbnailUrl, errorMessage: null }
  }
  if (status === 'failed' || status === 'error') {
    return { status: 'failed', videoUrl: null, thumbnailUrl, errorMessage: errorMessage || 'Avatar video render failed.' }
  }
  if (status === 'processing' || status === 'rendering' || status === 'waiting') {
    return { status: 'rendering', videoUrl: null, thumbnailUrl, errorMessage: null }
  }
  return { status: 'queued', videoUrl: null, thumbnailUrl, errorMessage: null }
}

async function appendAvatarVideoAsset(
  supabase: SupabaseClient,
  ideaId: string,
  userId: string,
  currentMediaAssets: unknown,
  videoUrl: string,
): Promise<void> {
  if (!ideaId || !userId || !videoUrl) return
  const mediaAssets = normalizeProofPoints(currentMediaAssets)
  if (!mediaAssets.some(asset => asset.value === videoUrl)) {
    mediaAssets.push({ label: 'Avatar video', value: videoUrl })
  }
  await supabase
    .from('gtm_content_ideas')
    .update({ media_assets: mediaAssets.slice(-12) })
    .eq('id', ideaId)
    .eq('user_id', userId)
}

interface ResolvedProviderConfig {
  provider: 'heygen' | 'generic'
  endpoint: string
  apiKey: string
}

function resolveProviderConfig(): ResolvedProviderConfig {
  const endpoint = process.env.AVATAR_VIDEO_API_URL?.trim() || process.env.HEYGEN_API_URL?.trim() || 'https://api.heygen.com/v1/video_agent/generate'
  const provider = /heygen\.com/i.test(endpoint) ? 'heygen' : 'generic'
  const apiKey = provider === 'heygen'
    ? process.env.HEYGEN_API_KEY?.trim() ?? ''
    : process.env.AVATAR_VIDEO_API_KEY?.trim() ?? ''
  return { provider, endpoint, apiKey }
}

function heyGenCallbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!base) return ''
  try {
    const url = new URL('/api/webhooks/heygen', base)
    const secret = process.env.HEYGEN_WEBHOOK_SECRET?.trim()
    if (secret) url.searchParams.set('secret', secret)
    return url.toString()
  } catch {
    return ''
  }
}

function providerError(data: Record<string, unknown> | null | undefined): string {
  if (!data) return ''
  const error = normalizeRecord(data.error)
  return stringValue(data.message) || stringValue(data.error) || stringValue(error.message) || stringValue(error.code)
}

function extractCaption(script: string): string {
  const captionLine = script.split(/\n+/).find(line => /^caption\s*:/i.test(line))
  if (captionLine) return captionLine.replace(/^caption\s*:\s*/i, '').trim().slice(0, 2200)
  return script.replace(/\s+/g, ' ').slice(0, 280)
}

function normalizeAvatarSpokenScript(value: string): string {
  const withoutLabels = value
    .split(/\n+/)
    .filter(line => !/^\s*(caption|shot|beat|visual|notes?|scene|b-roll|cta)\s*:/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = withoutLabels.split(/\s+/).filter(Boolean).slice(0, VIDEO_SCRIPT_MAX_WORDS)
  return words.join(' ').slice(0, VIDEO_SCRIPT_MAX_CHARS).trim()
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

function statusValue(value: unknown): AvatarVideoJobResult['status'] {
  if (value === 'queued' || value === 'rendering' || value === 'ready' || value === 'failed') return value
  return 'manual_ready'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
