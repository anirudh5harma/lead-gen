import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import {
  CRM_PROVIDER_PRESETS,
  normalizeCrmProvider,
} from '@/lib/crm-sync'
import { normalizeOutboundWebhookUrl } from '@/lib/http-safety'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let query = supabase
    .from('crm_sync_settings')
    .select('provider, webhook_url, enabled, export_mapping')
    .eq('user_id', user.id)
    .limit(1)

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { data: existing, error: existingError } = await query.maybeSingle()
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })

  let data = existing as {
    provider?: string | null
    webhook_url?: string | null
    enabled?: boolean | null
    export_mapping?: Record<string, unknown> | null
  } | null

  if (!data) {
    const { data: inserted, error: insertError } = await supabase
      .from('crm_sync_settings')
      .insert({
        user_id: user.id,
        client_id: activeClientId,
        provider: 'webhook',
        webhook_url: null,
        enabled: false,
      })
      .select('provider, webhook_url, enabled, export_mapping')
      .single()

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    data = inserted
  }

  return NextResponse.json({
    provider: normalizeCrmProvider(data?.provider),
    webhook_url: data?.webhook_url ?? '',
    enabled: Boolean(data?.enabled),
    export_mapping: data?.export_mapping ?? {},
    providers: CRM_PROVIDER_PRESETS.map(preset => ({
      ...preset,
      export_url: `/api/export/crm?provider=${preset.id}`,
    })),
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    provider?: string | null
    webhook_url?: string | null
    enabled?: boolean
  } | null

  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be provided' }, { status: 400 })
  }

  const rawWebhookUrl = typeof body.webhook_url === 'string' ? body.webhook_url.trim() : ''
  const webhookUrl = rawWebhookUrl ? normalizeOutboundWebhookUrl(rawWebhookUrl) : ''
  if (body.enabled && !webhookUrl) {
    return NextResponse.json({ error: 'A valid HTTPS outbound webhook URL is required when enabling CRM export.' }, { status: 400 })
  }
  if (rawWebhookUrl && !webhookUrl) {
    return NextResponse.json({ error: 'CRM webhook URL must be HTTPS and cannot point to localhost or private network addresses.' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const provider = normalizeCrmProvider(body.provider)
  const { error } = await supabase
    .from('crm_sync_settings')
    .upsert({
      user_id: user.id,
      client_id: activeClientId,
      provider,
      webhook_url: webhookUrl || null,
      enabled: body.enabled,
      import_enabled: false,
      export_mapping: {},
    }, { onConflict: 'user_id,client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    ok: true,
    provider,
    webhook_url: webhookUrl,
    enabled: body.enabled,
  })
}
