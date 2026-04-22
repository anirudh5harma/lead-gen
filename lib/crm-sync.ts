import { createAdminClient } from '@/lib/supabase/server'

export async function emitCrmLeadEvent(params: {
  userId: string
  clientId?: string | null
  eventType: 'lead.created' | 'lead.updated' | 'lead.sent' | 'lead.replied' | 'lead.booked'
  payload: Record<string, unknown>
}): Promise<void> {
  const { userId, clientId = null, eventType, payload } = params
  const supabase = createAdminClient()

  let query = supabase
    .from('crm_sync_settings')
    .select('webhook_url, enabled')
    .eq('user_id', userId)
    .eq('enabled', true)
    .limit(1)

  if (clientId) query = query.eq('client_id', clientId)
  else query = query.is('client_id', null)

  const { data: setting } = await query.maybeSingle()
  const webhookUrl = (setting as { webhook_url?: string | null } | null)?.webhook_url
  if (!webhookUrl) return

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: eventType,
      occurred_at: new Date().toISOString(),
      client_id: clientId,
      ...payload,
    }),
  })
}
