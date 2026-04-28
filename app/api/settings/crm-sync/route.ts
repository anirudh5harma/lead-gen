import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import {
  buildCrmImportUrl,
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
    .select('provider, webhook_url, enabled, import_enabled, import_secret, export_mapping, import_mapping')
    .eq('user_id', user.id)
    .limit(1)

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { data: existing, error: existingError } = await query.maybeSingle()
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })

  let data = existing as {
    provider?: string | null
    webhook_url?: string | null
    enabled?: boolean | null
    import_enabled?: boolean | null
    import_secret?: string | null
    export_mapping?: Record<string, unknown> | null
    import_mapping?: Record<string, unknown> | null
  } | null

  if (!data) {
    const secret = crypto.randomUUID()
    const { data: inserted, error: insertError } = await supabase
      .from('crm_sync_settings')
      .insert({
        user_id: user.id,
        client_id: activeClientId,
        provider: 'webhook',
        webhook_url: null,
        enabled: false,
        import_enabled: false,
        import_secret: secret,
      })
      .select('provider, webhook_url, enabled, import_enabled, import_secret, export_mapping, import_mapping')
      .single()

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    data = inserted
  } else if (!data.import_secret) {
    const secret = crypto.randomUUID()
    let updateQuery = supabase
      .from('crm_sync_settings')
      .update({ import_secret: secret })
      .eq('user_id', user.id)
      .select('provider, webhook_url, enabled, import_enabled, import_secret, export_mapping, import_mapping')
    updateQuery = activeClientId ? updateQuery.eq('client_id', activeClientId) : updateQuery.is('client_id', null)
    const { data: updated, error: updateError } = await updateQuery.single()

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    data = updated
  }

  return NextResponse.json({
    provider: normalizeCrmProvider(data?.provider),
    webhook_url: data?.webhook_url ?? '',
    enabled: Boolean(data?.enabled),
    import_enabled: Boolean(data?.import_enabled),
    import_url: data?.import_secret ? buildCrmImportUrl(data.import_secret) : '',
    export_mapping: data?.export_mapping ?? {},
    import_mapping: data?.import_mapping ?? {},
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
    import_enabled?: boolean
  } | null

  if (!body || typeof body.enabled !== 'boolean' || typeof body.import_enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled and import_enabled must be provided' }, { status: 400 })
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
  let existingQuery = supabase
    .from('crm_sync_settings')
    .select('import_secret')
    .eq('user_id', user.id)
    .limit(1)
  existingQuery = activeClientId ? existingQuery.eq('client_id', activeClientId) : existingQuery.is('client_id', null)
  const { data: existing } = await existingQuery.maybeSingle()
  const importSecret = (existing as { import_secret?: string | null } | null)?.import_secret ?? crypto.randomUUID()
  const { error } = await supabase
    .from('crm_sync_settings')
    .upsert({
      user_id: user.id,
      client_id: activeClientId,
      provider,
      webhook_url: webhookUrl || null,
      enabled: body.enabled,
      import_enabled: body.import_enabled,
      import_secret: importSecret,
      export_mapping: {},
      import_mapping: {},
    }, { onConflict: 'user_id,client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    ok: true,
    provider,
    webhook_url: webhookUrl,
    enabled: body.enabled,
    import_enabled: body.import_enabled,
    import_url: buildCrmImportUrl(importSecret),
  })
}
