import DodoPayments from 'dodopayments'
import { createAdminClient } from '@/lib/supabase/server'

export const dodo = new DodoPayments({
  bearerToken: process.env.DODO_API_KEY ?? '',
  environment: (process.env.DODO_ENV ?? 'live_mode') as 'live_mode' | 'test_mode',
})

export const PRODUCT_IDS = {
  pro: process.env.DODO_PRODUCT_PRO ?? '',
  max: process.env.DODO_PRODUCT_MAX ?? '',
}

export function planFromProductId(productId: string): 'pro' | 'max' | 'free' {
  if (productId === PRODUCT_IDS.pro) return 'pro'
  if (productId === PRODUCT_IDS.max) return 'max'
  return 'free'
}

export async function createCheckoutUrl(
  userEmail: string,
  userName: string,
  productId: string,
  userId: string,
): Promise<string> {
  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgraded=1`,
    customer: { email: userEmail, name: userName },
    metadata: { user_id: userId },
  })
  return (session as unknown as { checkout_url: string }).checkout_url
}

export async function recordLeadOverage(
  userId: string,
  leadId: string,
  prefix: 'overage' | 'overage_followup' = 'overage',
): Promise<void> {
  const eventName = process.env.DODO_OVERAGE_EVENT_NAME ?? 'lead_overage'
  if (!process.env.DODO_API_KEY) return

  const supabase = createAdminClient()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('dodo_customer_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!sub?.dodo_customer_id) return

  await dodo.usageEvents.ingest({
    events: [{
      customer_id: sub.dodo_customer_id,
      event_id:    `${prefix}_${leadId}`,
      event_name:  eventName,
      timestamp:   new Date().toISOString(),
      metadata:    { user_id: userId, lead_id: leadId },
    }],
  })
}

export function getPortalUrl(): string {
  const businessId = process.env.DODO_BUSINESS_ID ?? ''
  const env = process.env.DODO_ENV ?? 'live_mode'
  const base = env === 'test_mode'
    ? 'https://test.customer.dodopayments.com'
    : 'https://customer.dodopayments.com'
  return `${base}/login/${businessId}`
}
