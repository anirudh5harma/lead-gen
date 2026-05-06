import type { SupabaseClient } from '@supabase/supabase-js'

export interface AvatarVideoJobResult {
  id: string
  status: 'manual_ready' | 'queued' | 'rendering' | 'ready' | 'failed'
  provider: string
  video_url: string | null
  thumbnail_url: string | null
}

export async function createAvatarVideoJob(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    ideaId: string
    settings?: Record<string, unknown> | null
  },
): Promise<AvatarVideoJobResult> {
  let ideaQuery = supabase
    .from('gtm_content_ideas')
    .select('id, content_type, angle, draft, final_body, source_insights, media_assets, draft_settings')
    .eq('id', input.ideaId)
    .eq('user_id', input.userId)
  ideaQuery = input.clientId ? ideaQuery.eq('client_id', input.clientId) : ideaQuery.is('client_id', null)
  const { data: idea, error } = await ideaQuery.maybeSingle()
  if (error) throw new Error(error.message)
  if (!idea) throw new Error('Content idea not found')
  if ((idea as { content_type?: string }).content_type !== 'video_script') throw new Error('Avatar video generation requires a video content item.')

  const draft = normalizeRecord((idea as Record<string, unknown>).draft)
  const script = stringValue((idea as Record<string, unknown>).final_body) || stringValue(draft.body) || stringValue((idea as Record<string, unknown>).angle)
  if (script.length < 12) throw new Error('Draft the video script before preparing an avatar video.')
  const caption = extractCaption(script)
  const settings = { ...normalizeRecord((idea as Record<string, unknown>).draft_settings), ...normalizeRecord(input.settings) }
  const providerResult = await requestProviderRender({
    script,
    caption,
    title: stringValue(draft.title) || stringValue((idea as Record<string, unknown>).angle),
    settings,
    metadata: { content_idea_id: input.ideaId },
  })

  const provider = providerResult.provider
  const status = providerResult.status
  const { data: job, error: insertError } = await supabase
    .from('gtm_avatar_video_jobs')
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      content_idea_id: input.ideaId,
      provider,
      status,
      script,
      caption,
      video_url: providerResult.videoUrl,
      thumbnail_url: providerResult.thumbnailUrl,
      provider_job_id: providerResult.providerJobId,
      metadata: { settings, ai_avatar: true, inspiration_only: true },
    })
    .select('id, status, provider, video_url, thumbnail_url')
    .single()
  if (insertError) throw new Error(insertError.message)

  if (providerResult.videoUrl) {
    const mediaAssets = normalizeProofPoints((idea as Record<string, unknown>).media_assets)
    mediaAssets.push({ label: 'Avatar video', value: providerResult.videoUrl })
    await supabase
      .from('gtm_content_ideas')
      .update({ media_assets: mediaAssets.slice(-12) })
      .eq('id', input.ideaId)
      .eq('user_id', input.userId)
  }

  return {
    id: stringValue((job as Record<string, unknown>).id),
    status: statusValue((job as Record<string, unknown>).status),
    provider: stringValue((job as Record<string, unknown>).provider) || provider,
    video_url: stringValue((job as Record<string, unknown>).video_url) || null,
    thumbnail_url: stringValue((job as Record<string, unknown>).thumbnail_url) || null,
  }
}

async function requestProviderRender(input: {
  script: string
  caption: string
  title: string
  settings: Record<string, unknown>
  metadata: Record<string, unknown>
}): Promise<{
  provider: string
  status: 'manual_ready' | 'queued' | 'rendering' | 'ready'
  videoUrl: string | null
  thumbnailUrl: string | null
  providerJobId: string | null
}> {
  const endpoint = process.env.AVATAR_VIDEO_API_URL
  const apiKey = process.env.AVATAR_VIDEO_API_KEY
  if (!endpoint || !apiKey) {
    return { provider: 'manual_ready', status: 'manual_ready', videoUrl: null, thumbnailUrl: null, providerJobId: null }
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000),
  })
  const data = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !data) throw new Error(stringValue(data?.error) || `Avatar video provider failed with ${res.status}`)
  return {
    provider: stringValue(data.provider) || 'avatar_provider',
    status: data.video_url ? 'ready' : 'queued',
    videoUrl: stringValue(data.video_url) || null,
    thumbnailUrl: stringValue(data.thumbnail_url) || null,
    providerJobId: stringValue(data.job_id) || null,
  }
}

function extractCaption(script: string): string {
  const captionLine = script.split(/\n+/).find(line => /^caption\s*:/i.test(line))
  if (captionLine) return captionLine.replace(/^caption\s*:\s*/i, '').trim().slice(0, 2200)
  return script.replace(/\s+/g, ' ').slice(0, 280)
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
