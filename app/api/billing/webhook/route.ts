import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { Webhook } from 'standardwebhooks'
import { addLeadCreditsForPayment } from '@/lib/lead-credits'

export const runtime = 'nodejs'

interface DodoWebhookPayload {
  type: string
  data: {
    subscription_id?: string
    product_id?: string
    payment_id?: string
    total_amount?: number
    status?: string
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

  // Handle PAYG credit purchases
  if (type === 'payment.succeeded' && data.metadata?.purchase_type === 'lead_credits') {
    const userId = data.metadata.user_id
    const paymentId = data.payment_id
    const credits = Number(data.metadata.credits)
    const amountDollars = Number(data.metadata.amount_dollars)

    if (!userId || !paymentId || !Number.isFinite(credits) || credits <= 0) {
      console.warn('[dodo webhook] Invalid lead credit payment metadata', data.metadata)
      return NextResponse.json({ ok: true })
    }

    await addLeadCreditsForPayment(supabase, {
      userId,
      paymentId,
      credits: Math.floor(credits),
      amountDollars: Number.isFinite(amountDollars) ? amountDollars : (data.total_amount ?? 0) / 100,
      metadata: {
        dodo_customer_id: data.customer?.customer_id,
        dodo_total_amount: data.total_amount ?? null,
      },
    })

    return NextResponse.json({ ok: true })
  }

  // Handle subscription creation/renewal
  if ((type === 'subscription.created' || type === 'subscription.renewed') && data.metadata?.purchase_type === 'subscription') {
    const userId = data.metadata.user_id
    const tier = data.metadata.tier as 'growth' | 'scale' | 'enterprise'
    const period = data.metadata.period as 'monthly' | 'annual'

    if (!userId || !tier) {
      console.warn('[dodo webhook] Invalid subscription metadata', data.metadata)
      return NextResponse.json({ ok: true })
    }

    await supabase.from('user_profiles').update({
      plan: tier,
      subscription_status: 'active',
      subscription_period: period,
      subscription_external_id: data.subscription_id ?? null,
      subscription_renews_at: data.next_billing_date ?? null,
      leads_used_this_month: 0,
      leads_reset_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId)

    await supabase.from('subscriptions').upsert({
      user_id: userId,
      dodo_customer_id: data.customer?.customer_id ?? null,
      dodo_subscription_id: data.subscription_id ?? null,
      plan: tier,
      status: 'active',
      next_billing_date: data.next_billing_date ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    return NextResponse.json({ ok: true })
  }

  // Handle subscription cancellation
  if (type === 'subscription.cancelled' || type === 'subscription.expired') {
    const userId = data.metadata?.user_id
    if (userId) {
      await supabase.from('user_profiles').update({
        subscription_status: 'canceled',
        subscription_renews_at: null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId)

      await supabase.from('subscriptions').update({
        status: 'canceled',
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId)
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: true })
}
