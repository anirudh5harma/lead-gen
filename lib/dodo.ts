import DodoPayments from 'dodopayments'

type DodoEnvironment = 'live_mode' | 'test_mode'

function cleanEnvValue(value?: string | null): string {
  return (value ?? '').split(/\s+#/, 1)[0].trim()
}

function getDodoEnvironment(): DodoEnvironment {
  return cleanEnvValue(process.env.DODO_ENV) === 'test_mode' ? 'test_mode' : 'live_mode'
}

function getDodoClient(): DodoPayments {
  return new DodoPayments({
    bearerToken: cleanEnvValue(process.env.DODO_API_KEY),
    environment: getDodoEnvironment(),
  })
}

export const PRODUCT_IDS = {
  leadCredits: cleanEnvValue(process.env.DODO_PRODUCT_LEAD_CREDITS),
}

export interface DodoPaymentDetails {
  payment_id?: string | null
  status?: string | null
  currency?: string | null
  total_amount?: number | null
  metadata?: Record<string, string> | null
  customer?: {
    customer_id?: string | null
    email?: string | null
  } | null
  product_cart?: Array<{
    product_id?: string | null
    quantity?: number | null
  }> | null
}

export async function createLeadCreditCheckoutUrl(params: {
  userEmail: string
  userName: string
  userId: string
  amountDollars: number
  credits: number
}): Promise<string> {
  if (!PRODUCT_IDS.leadCredits) {
    throw new Error('DODO_PRODUCT_LEAD_CREDITS env var not set')
  }

  const session = await getDodoClient().checkoutSessions.create({
    product_cart: [{
      product_id: PRODUCT_IDS.leadCredits,
      quantity: 1,
      amount: params.amountDollars * 100,
    }],
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?view=settings&credits=1`,
    feature_flags: { redirect_immediately: true },
    customer: { email: params.userEmail, name: params.userName },
    metadata: {
      purchase_type: 'lead_credits',
      user_id: params.userId,
      amount_dollars: String(params.amountDollars),
      credits: String(params.credits),
    },
  })
  return (session as unknown as { checkout_url: string }).checkout_url
}

export async function retrieveDodoPayment(paymentId: string): Promise<DodoPaymentDetails> {
  return await getDodoClient().payments.retrieve(paymentId) as DodoPaymentDetails
}

export async function retrieveDodoCheckoutSession(sessionId: string): Promise<{
  id?: string
  payment_id?: string | null
  payment_status?: string | null
}> {
  return await getDodoClient().checkoutSessions.retrieve(sessionId) as {
    id?: string
    payment_id?: string | null
    payment_status?: string | null
  }
}

export function getPortalUrl(): string {
  const businessId = cleanEnvValue(process.env.DODO_BUSINESS_ID)
  const env = getDodoEnvironment()
  const base = env === 'test_mode'
    ? 'https://test.customer.dodopayments.com'
    : 'https://customer.dodopayments.com'
  return `${base}/login/${businessId}`
}

export function getDodoConfigSummary(): {
  environment: DodoEnvironment
  hasApiKey: boolean
  hasLeadCreditsProduct: boolean
  hasBusinessId: boolean
} {
  return {
    environment: getDodoEnvironment(),
    hasApiKey: Boolean(cleanEnvValue(process.env.DODO_API_KEY)),
    hasLeadCreditsProduct: Boolean(PRODUCT_IDS.leadCredits),
    hasBusinessId: Boolean(cleanEnvValue(process.env.DODO_BUSINESS_ID)),
  }
}
