import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientContext } from '@/lib/client-context'
import { getUserPlan } from '@/lib/plan'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await getUserPlan(user.id)
  if (plan !== 'max') {
    return NextResponse.json({ error: 'CRM sync requires the Max plan.' }, { status: 403 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let query = supabase
    .from('crm_sync_settings')
    .select('provider, webhook_url, enabled')
    .eq('user_id', user.id)
    .limit(1)

  query = activeClientId ? query.eq('client_id', activeClientId) : query.is('client_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    provider: (data as { provider?: string } | null)?.provider ?? 'webhook',
    webhook_url: (data as { webhook_url?: string | null } | null)?.webhook_url ?? '',
    enabled: (data as { enabled?: boolean } | null)?.enabled ?? false,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await getUserPlan(user.id)
  if (plan !== 'max') {
    return NextResponse.json({ error: 'CRM sync requires the Max plan.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    webhook_url?: string | null
    enabled?: boolean
  } | null

  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be provided' }, { status: 400 })
  }

  const webhookUrl = typeof body.webhook_url === 'string' ? body.webhook_url.trim() : ''
  if (body.enabled && !webhookUrl) {
    return NextResponse.json({ error: 'webhook_url required when enabling CRM sync' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const { error } = await supabase
    .from('crm_sync_settings')
    .upsert({
      user_id: user.id,
      client_id: activeClientId,
      provider: 'webhook',
      webhook_url: webhookUrl || null,
      enabled: body.enabled,
    }, { onConflict: 'user_id,client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, webhook_url: webhookUrl, enabled: body.enabled })
}
