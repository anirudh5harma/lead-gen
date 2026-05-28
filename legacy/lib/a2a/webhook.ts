import type { SupabaseClient } from '@supabase/supabase-js'
import { signWebhookPayload } from './audit'

interface WebhookSubscription {
  id: string
  url: string
  secret: string
  event_types: string[]
  min_score: number
  icp_filter: Record<string, unknown>
}

export async function getActiveWebhooks(
  supabase: SupabaseClient,
  agentId: string,
  eventType: string,
): Promise<WebhookSubscription[]> {
  const { data } = await supabase
    .from('agent_webhook_subscriptions')
    .select('id, url, secret, event_types, min_score, icp_filter')
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .contains('event_types', [eventType])

  return (data ?? []).map(row => ({
    id: row.id,
    url: row.url,
    secret: row.secret,
    event_types: row.event_types ?? [],
    min_score: row.min_score ?? 7,
    icp_filter: row.icp_filter ?? {},
  }))
}

export async function deliverWebhook(
  supabase: SupabaseClient,
  subscription: WebhookSubscription,
  eventType: string,
  payload: Record<string, unknown>,
  signalId?: string,
): Promise<{ success: boolean; status?: number; error?: string; durationMs?: number }> {
  const signedPayload = {
    ...payload,
    _meta: {
      event_type: eventType,
      delivered_at: new Date().toISOString(),
      subscription_id: subscription.id,
    },
  }

  const signature = signWebhookPayload(signedPayload, subscription.secret)

  const start = Date.now()
  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bombsell-Signature': signature,
        'X-Bombsell-Event': eventType,
        'X-Bombsell-Subscription': subscription.id,
        'User-Agent': 'Bombsell-Agent-Webhook/1.0',
      },
      body: JSON.stringify(signedPayload),
      signal: AbortSignal.timeout(15000),
    })

    const durationMs = Date.now() - start

    await logWebhookDelivery(supabase, subscription.id, eventType, signedPayload, response.status, await response.text().catch(() => ''), durationMs, response.ok, signalId)

    if (response.ok) {
      await updateSubscriptionDelivery(supabase, subscription.id, true)
      return { success: true, status: response.status, durationMs }
    }

    await updateSubscriptionDelivery(supabase, subscription.id, false, `HTTP ${response.status}`)
    return { success: false, status: response.status, durationMs }
  } catch (error) {
    const durationMs = Date.now() - start
    const errorMessage = error instanceof Error ? error.message : String(error)
    await logWebhookDelivery(supabase, subscription.id, eventType, signedPayload, 0, errorMessage, durationMs, false, signalId)
    await updateSubscriptionDelivery(supabase, subscription.id, false, errorMessage)
    return { success: false, error: errorMessage, durationMs }
  }
}

async function logWebhookDelivery(
  supabase: SupabaseClient,
  subscriptionId: string,
  eventType: string,
  payload: Record<string, unknown>,
  responseStatus: number,
  responseBody: string,
  durationMs: number,
  success: boolean,
  signalId?: string,
): Promise<void> {
  await supabase.from('agent_webhook_deliveries').insert({
    subscription_id: subscriptionId,
    event_type: eventType,
    payload,
    response_status: responseStatus,
    response_body: responseBody.slice(0, 2000),
    delivery_duration_ms: durationMs,
    success,
    signal_id: signalId ?? null,
  })
}

async function updateSubscriptionDelivery(
  supabase: SupabaseClient,
  subscriptionId: string,
  success: boolean,
  error?: string,
): Promise<void> {
  await supabase
    .from('agent_webhook_subscriptions')
    .update({
      last_delivered_at: success ? new Date().toISOString() : undefined,
      last_error_at: !success ? new Date().toISOString() : undefined,
      last_error: error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId)
}

export async function broadcastToAgentWebhooks(
  supabase: SupabaseClient,
  agentId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ delivered: number; failed: number }> {
  const subscriptions = await getActiveWebhooks(supabase, agentId, eventType)
  let delivered = 0
  let failed = 0

  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await deliverWebhook(supabase, sub, eventType, payload)
      if (result.success) delivered++
      else failed++
    }),
  )

  return { delivered, failed }
}
