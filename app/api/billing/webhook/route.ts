import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { planFromProductId } from '@/lib/dodo'
import { Webhook } from 'standardwebhooks'

export const runtime = 'nodejs'

interface DodoWebhookPayload {
  type: string
  data: {
    subscription_id: string
    product_id: string
    status: string
    next_billing_date?: string
    customer: {
      customer_id: string
      email: string
    }
    metadata?: Record<string, string>
  }
}

export async function POST(request: Request) {
  const secret = process.env.DODO_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const rawBody = await request.text()

  // Verify signature using standardwebhooks (Dodo's verification method)
  try {
    const wh = new Webhook(secret)
    wh.verify(rawBody, {
      'webhook-id':        request.headers.get('webhook-id') ?? '',
      'webhook-signature': request.headers.get('webhook-signature') ?? '',
      'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
    })
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: DodoWebhookPayload
  try {
    event = JSON.parse(rawBody) as DodoWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = await createServiceClient()
  const { type, data } = event

  if (
    type === 'subscription.created' ||
    type === 'subscription.active' ||
    type === 'subscription.updated' ||
    type === 'subscription.plan_changed'
  ) {
    const plan = planFromProductId(data.product_id)
    let userId = data.metadata?.user_id

    if (!userId) {
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('dodo_subscription_id', data.subscription_id)
        .maybeSingle()
      userId = existingSub?.user_id
    }

    if (!userId) {
      console.warn('[dodo webhook] Missing user_id in metadata for', data.subscription_id)
      return NextResponse.json({ ok: true })
    }

    await supabase.from('subscriptions').upsert({
      user_id:              userId,
      dodo_customer_id:     data.customer.customer_id,
      dodo_subscription_id: data.subscription_id,
      plan,
      status:               data.status,
      next_billing_date:    data.next_billing_date ?? null,
      ...(plan !== 'max'
        ? {
            workspace_downgrade_warning_sent_at: null,
            workspace_downgrade_warning_cycle_at: null,
          }
        : {}),
      updated_at:           new Date().toISOString(),
    }, { onConflict: 'user_id' })

    const profileUpdate: Record<string, unknown> = { plan }
    if (plan === 'free') profileUpdate.allow_lead_overage = false
    await supabase.from('user_profiles').update(profileUpdate).eq('user_id', userId)
  }

  if (type === 'subscription.cancelled' || type === 'subscription.expired') {
    const { data: record } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('dodo_subscription_id', data.subscription_id)
      .maybeSingle()

    if (record?.user_id) {
      await supabase.from('user_profiles').update({
        plan: 'free',
        allow_lead_overage: false,
      }).eq('user_id', record.user_id)
      await supabase.from('subscriptions').update({
        plan:       'free',
        status:     data.status,
        workspace_downgrade_warning_sent_at: null,
        workspace_downgrade_warning_cycle_at: null,
        updated_at: new Date().toISOString(),
      }).eq('dodo_subscription_id', data.subscription_id)
    }
  }

  return NextResponse.json({ ok: true })
}
