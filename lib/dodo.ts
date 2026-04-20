import DodoPayments from 'dodopayments'

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

export function getPortalUrl(): string {
  const businessId = process.env.DODO_BUSINESS_ID ?? ''
  const env = process.env.DODO_ENV ?? 'live_mode'
  const base = env === 'test_mode'
    ? 'https://test.customer.dodopayments.com'
    : 'https://customer.dodopayments.com'
  return `${base}/login/${businessId}`
}
