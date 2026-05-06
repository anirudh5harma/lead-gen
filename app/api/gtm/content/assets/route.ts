import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { checkRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = 'marketing-content-assets'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rate = await checkRateLimit(`marketing:asset:${user.id}`, 40, 60 * 60, { supabase })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many asset uploads. Try again later.' }, { status: 429 })

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (file.size <= 0) return NextResponse.json({ error: 'file is empty' }, { status: 400 })
  if (file.size > 100 * 1024 * 1024) return NextResponse.json({ error: 'file must be 100MB or smaller' }, { status: 400 })

  const ideaId = stringValue(form.get('idea_id'))
  const label = stringValue(form.get('label')) || file.name || 'Asset'
  const assetType = assetTypeForMime(file.type)
  if (!assetType) return NextResponse.json({ error: 'Unsupported asset type' }, { status: 400 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  if (ideaId) {
    let ideaQuery = supabase.from('gtm_content_ideas').select('id, media_assets').eq('id', ideaId).eq('user_id', user.id)
    ideaQuery = activeClientId ? ideaQuery.eq('client_id', activeClientId) : ideaQuery.is('client_id', null)
    const { data: idea, error: ideaError } = await ideaQuery.maybeSingle()
    if (ideaError) return NextResponse.json({ error: ideaError.message }, { status: 500 })
    if (!idea) return NextResponse.json({ error: 'Content idea not found' }, { status: 404 })
  }

  const ext = extensionForFile(file)
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `asset.${ext}`
  const path = `${user.id}/${activeClientId ?? 'workspace'}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const url = publicUrl.publicUrl

  const { data: asset, error: assetError } = await supabase
    .from('gtm_content_assets')
    .insert({
      user_id: user.id,
      client_id: activeClientId,
      content_idea_id: ideaId || null,
      asset_type: assetType,
      label: label.slice(0, 120),
      url,
      mime_type: file.type || null,
      storage_path: path,
      metadata: { file_name: file.name, size: file.size, source: 'upload' },
    })
    .select('id, asset_type, label, url, mime_type, storage_path')
    .single()
  if (assetError) return NextResponse.json({ error: assetError.message }, { status: 500 })

  if (ideaId) {
    const { data: current } = await supabase.from('gtm_content_ideas').select('media_assets').eq('id', ideaId).maybeSingle()
    const mediaAssets = normalizeAssetList((current as { media_assets?: unknown } | null)?.media_assets)
    mediaAssets.push({ label: label.slice(0, 80), value: url })
    await supabase.from('gtm_content_ideas').update({ media_assets: mediaAssets.slice(-12) }).eq('id', ideaId)
  }

  return NextResponse.json({ ok: true, asset })
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function assetTypeForMime(mime: string): 'image' | 'video' | 'document' | 'note' | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'document'
  if (mime.startsWith('text/')) return 'note'
  return null
}

function extensionForFile(file: File): string {
  const existing = file.name.split('.').pop()
  if (existing && existing.length <= 8) return existing
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/jpeg') return 'jpg'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'video/mp4') return 'mp4'
  if (file.type === 'video/webm') return 'webm'
  return 'asset'
}

function normalizeAssetList(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      return typeof row.label === 'string' && typeof row.value === 'string'
        ? { label: row.label, value: row.value }
        : null
    })
    .filter((item): item is { label: string; value: string } => Boolean(item))
}
