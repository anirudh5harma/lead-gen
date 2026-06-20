import DodoPayments from "dodopayments";

export type DodoEnvironment = "live_mode" | "test_mode";
export type DodoProBillingPeriod = "monthly" | "annual";

export const PRODUCT_IDS = {
  proMonthly: cleanEnvValue(process.env.DODO_PRODUCT_LAUNCH_MONTHLY),
  proAnnual: cleanEnvValue(process.env.DODO_PRODUCT_LAUNCH_ANNUAL),
} as const;

export interface CreateSubscriptionCheckoutUrlParams {
  userEmail: string;
  userName: string;
  userId: string;
  workspaceId: string;
  period: DodoProBillingPeriod;
  returnUrl: string;
  cancelUrl?: string;
}

export interface DodoPaymentDetails {
  payment_id?: string | null;
  status?: string | null;
  currency?: string | null;
  total_amount?: number | null;
  metadata?: Record<string, string> | null;
  customer?: {
    customer_id?: string | null;
    email?: string | null;
  } | null;
  product_cart?: Array<{
    product_id?: string | null;
    quantity?: number | null;
  }> | null;
}

export interface DodoCheckoutSessionDetails {
  id?: string;
  session_id?: string;
  payment_id?: string | null;
  payment_status?: string | null;
  customer_email?: string | null;
  customer_name?: string | null;
}

export function cleanEnvValue(value?: string | null): string {
  return (value ?? "").split(/\s+#/, 1)[0].trim();
}

export function getDodoEnvironment(): DodoEnvironment {
  return cleanEnvValue(process.env.DODO_ENV) === "test_mode"
    ? "test_mode"
    : "live_mode";
}

export function dodoProductIdForPeriod(period: DodoProBillingPeriod): string {
  return period === "annual" ? PRODUCT_IDS.proAnnual : PRODUCT_IDS.proMonthly;
}

export function dodoPeriodForProductId(
  productId: string | null | undefined,
): DodoProBillingPeriod | null {
  if (!productId) return null;
  if (productId === PRODUCT_IDS.proMonthly) return "monthly";
  if (productId === PRODUCT_IDS.proAnnual) return "annual";
  return null;
}

export function isConfiguredProProductId(productId: string | null | undefined): boolean {
  return Boolean(dodoPeriodForProductId(productId));
}

export async function createSubscriptionCheckoutUrl(
  params: CreateSubscriptionCheckoutUrlParams,
): Promise<string> {
  const productId = dodoProductIdForPeriod(params.period);
  if (!productId) {
    throw new Error(`Dodo Pro product is not configured for ${params.period}`);
  }

  const session = await getDodoClient().checkoutSessions.create({
    product_cart: [
      {
        product_id: productId,
        quantity: 1,
      },
    ],
    return_url: params.returnUrl,
    cancel_url: params.cancelUrl ?? null,
    feature_flags: { redirect_immediately: true },
    customer: {
      email: params.userEmail,
      name: params.userName,
    },
    metadata: {
      purchase_type: "subscription",
      provider: "dodo",
      plan: "pro",
      tier: "pro",
      period: params.period,
      user_id: params.userId,
      workspace_id: params.workspaceId,
    },
  });

  if (!session.checkout_url) {
    throw new Error("Dodo did not return a checkout URL");
  }
  return session.checkout_url;
}

export async function retrieveDodoPayment(
  paymentId: string,
): Promise<DodoPaymentDetails> {
  return await getDodoClient().payments.retrieve(paymentId) as DodoPaymentDetails;
}

export async function retrieveDodoCheckoutSession(
  sessionId: string,
): Promise<DodoCheckoutSessionDetails> {
  return await getDodoClient().checkoutSessions.retrieve(
    sessionId,
  ) as DodoCheckoutSessionDetails;
}

export async function getPortalUrl(params?: {
  customerId?: string | null;
  returnUrl?: string;
}): Promise<string> {
  const customerId = cleanEnvValue(params?.customerId);
  if (customerId) {
    const session = await getDodoClient().customers.customerPortal.create(
      customerId,
      params?.returnUrl ? { return_url: params.returnUrl } : undefined,
    );
    return session.link;
  }

  const businessId = cleanEnvValue(process.env.DODO_BUSINESS_ID);
  if (!businessId) {
    throw new Error("DODO_BUSINESS_ID env var not set");
  }
  const base = getDodoEnvironment() === "test_mode"
    ? "https://test.customer.dodopayments.com"
    : "https://customer.dodopayments.com";
  return `${base}/login/${businessId}`;
}

export function getDodoConfigSummary(): {
  environment: DodoEnvironment;
  hasApiKey: boolean;
  hasProMonthly: boolean;
  hasProAnnual: boolean;
  hasBusinessId: boolean;
} {
  return {
    environment: getDodoEnvironment(),
    hasApiKey: Boolean(cleanEnvValue(process.env.DODO_API_KEY)),
    hasProMonthly: Boolean(PRODUCT_IDS.proMonthly),
    hasProAnnual: Boolean(PRODUCT_IDS.proAnnual),
    hasBusinessId: Boolean(cleanEnvValue(process.env.DODO_BUSINESS_ID)),
  };
}

function getDodoClient(): DodoPayments {
  return new DodoPayments({
    bearerToken: cleanEnvValue(process.env.DODO_API_KEY),
    environment: getDodoEnvironment(),
  });
}
