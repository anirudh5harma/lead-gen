import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { addLeadCreditsForPayment, computeLeadCreditsForDollars } from '@/lib/lead-credits'
import { PRODUCT_IDS, retrieveDodoCheckoutSession, retrieveDodoPayment, type DodoPaymentDetails } from '@/lib/dodo'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await checkRateLimit(`billing-credit-sync:${user.id}`, 20, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many payment sync attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const body = await request.json().catch(() => null) as {
    payment_id?: unknown
    checkout_session_id?: unknown
  } | null

  let paymentId = typeof body?.payment_id === 'string' ? body.payment_id.trim() : ''
  const checkoutSessionId = typeof body?.checkout_session_id === 'string' ? body.checkout_session_id.trim() : ''

  if (!paymentId && checkoutSessionId) {
    const session = await retrieveDodoCheckoutSession(checkoutSessionId).catch(() => null)
    if (!session?.payment_id) {
      return NextResponse.json({ ok: true, credited: false, pending: true })
    }
    paymentId = session.payment_id
  }

  if (!paymentId) {
    return NextResponse.json({ error: 'payment_id or checkout_session_id required' }, { status: 400 })
  }

  const payment = await retrieveDodoPayment(paymentId).catch(error => {
    console.error('[billing/credits/sync] dodo payment retrieve failed', {
      paymentId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  })

  if (!payment) {
    return NextResponse.json({ error: 'Unable to verify payment with Dodo right now.' }, { status: 502 })
  }

  const result = validateLeadCreditPayment(payment, user.id, user.email ?? null)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const service = await createServiceClient()
  const balance = await addLeadCreditsForPayment(service, {
    userId: user.id,
    paymentId: result.paymentId,
    credits: result.credits,
    amountDollars: result.amountDollars,
    metadata: {
      dodo_customer_id: payment.customer?.customer_id ?? null,
      dodo_total_amount: payment.total_amount ?? null,
      reconciled_from: 'redirect_sync',
    },
  })

  return NextResponse.json({
    ok: true,
    credited: true,
    balance,
    credits: result.credits,
  })
}

function validateLeadCreditPayment(
  payment: DodoPaymentDetails,
  expectedUserId: string,
  expectedEmail: string | null,
): (
  | { ok: true; paymentId: string; credits: number; amountDollars: number }
  | { ok: false; status: number; error: string }
) {
  if (payment.status !== 'succeeded') {
    return { ok: false, status: 409, error: 'Payment has not succeeded yet.' }
  }

  const metadata = payment.metadata ?? {}
  const productMatches = Boolean(
    PRODUCT_IDS.leadCredits &&
    payment.product_cart?.some(item => item.product_id === PRODUCT_IDS.leadCredits),
  )
  const metadataMatches = metadata.purchase_type === 'lead_credits'
  if (!metadataMatches && !productMatches) {
    return { ok: false, status: 400, error: 'Payment is not a lead-credit top-up.' }
  }

  const emailMatches = Boolean(
    expectedEmail &&
    payment.customer?.email &&
    payment.customer.email.toLowerCase() === expectedEmail.toLowerCase(),
  )
  if (metadata.user_id ? metadata.user_id !== expectedUserId : !emailMatches) {
    return { ok: false, status: 403, error: 'Payment does not belong to this account.' }
  }

  if (
    PRODUCT_IDS.leadCredits &&
    payment.product_cart?.length &&
    !payment.product_cart.some(item => item.product_id === PRODUCT_IDS.leadCredits)
  ) {
    return { ok: false, status: 400, error: 'Payment product does not match lead credits.' }
  }

  const paymentId = payment.payment_id?.trim()
  const metadataCredits = Number(metadata.credits)
  const metadataAmountDollars = Number(metadata.amount_dollars)
  const amountDollars = Number.isFinite(metadataAmountDollars) && metadataAmountDollars > 0
    ? metadataAmountDollars
    : payment.currency === 'USD'
      ? (payment.total_amount ?? 0) / 100
      : 0
  const credits = Number.isFinite(metadataCredits) && metadataCredits > 0
    ? Math.floor(metadataCredits)
    : computeLeadCreditsForDollars(amountDollars)

  if (!paymentId || credits <= 0) {
    return { ok: false, status: 400, error: 'Payment metadata is missing credit details.' }
  }

  return { ok: true, paymentId, credits, amountDollars }
}
