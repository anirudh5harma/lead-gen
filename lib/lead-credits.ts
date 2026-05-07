import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_CREDITS_PER_DOLLAR = 4

export const CREDIT_TOP_UP_AMOUNTS = [20, 50, 100] as const
export const STARTER_LEAD_CREDITS = 10

export const SUBSCRIPTION_TIERS = {
  free: {
    id: 'free',
    name: 'Launch',
    monthlyPrice: 0,
    annualPrice: 0,
    includedLeads: 0,
    overageRate: 0,
    maxInboxes: 1,
    hasExplore: false,
    hasAutoSend: false,
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    monthlyPrice: 49,
    annualPrice: 490,
    includedLeads: 60,
    overageRate: 0.65,
    maxInboxes: 3,
    hasExplore: true,
    hasAutoSend: true,
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    monthlyPrice: 99,
    annualPrice: 990,
    includedLeads: 200,
    overageRate: 0.5,
    maxInboxes: 10,
    hasExplore: true,
    hasAutoSend: true,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: 0,
    annualPrice: 0,
    includedLeads: 10000,
    overageRate: 0,
    maxInboxes: 999,
    hasExplore: true,
    hasAutoSend: true,
  },
} as const

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS

export interface UserSubscriptionState {
  plan: SubscriptionTier
  subscriptionStatus: 'none' | 'active' | 'canceled' | 'past_due'
  subscriptionPeriod: 'monthly' | 'annual' | null
  subscriptionRenewsAt: string | null
  leadsUsedThisMonth: number
  leadsResetAt: string
  leadCreditBalance: number
  includedLeads: number
  remainingIncludedLeads: number
}

export function getTierConfig(tier: SubscriptionTier) {
  return SUBSCRIPTION_TIERS[tier] ?? SUBSCRIPTION_TIERS.free
}

export function getLeadCreditsPerDollar(): number {
  const configured = Number(process.env.LEAD_CREDITS_PER_DOLLAR)
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_CREDITS_PER_DOLLAR
}

export function computeLeadCreditsForDollars(dollars: number): number {
  if (!Number.isFinite(dollars) || dollars <= 0) return 0
  return Math.floor(dollars * getLeadCreditsPerDollar())
}

export function normalizeCreditTopUpAmount(value: unknown): number | null {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN
  if (!Number.isFinite(amount)) return null
  const rounded = Math.round(amount)
  return CREDIT_TOP_UP_AMOUNTS.includes(rounded as (typeof CREDIT_TOP_UP_AMOUNTS)[number])
    ? rounded
    : null
}

export function getPaygPackCredits(amountDollars: number): number {
  // Non-subscriber PAYG packs: better value at higher amounts
  switch (amountDollars) {
    case 20: return 25
    case 50: return 75
    case 100: return 200
    default: return computeLeadCreditsForDollars(amountDollars)
  }
}

export async function getUserSubscriptionState(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSubscriptionState | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('plan, subscription_status, subscription_period, subscription_renews_at, leads_used_this_month, leads_reset_at, lead_credit_balance')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return null

  const plan = (data.plan as SubscriptionTier) || 'free'
  const config = getTierConfig(plan)
  const leadsUsed = data.leads_used_this_month ?? 0

  return {
    plan,
    subscriptionStatus: data.subscription_status as UserSubscriptionState['subscriptionStatus'],
    subscriptionPeriod: data.subscription_period as UserSubscriptionState['subscriptionPeriod'],
    subscriptionRenewsAt: data.subscription_renews_at,
    leadsUsedThisMonth: leadsUsed,
    leadsResetAt: data.leads_reset_at ?? new Date().toISOString(),
    leadCreditBalance: data.lead_credit_balance ?? 0,
    includedLeads: config.includedLeads,
    remainingIncludedLeads: Math.max(0, config.includedLeads - leadsUsed),
  }
}

export async function addLeadCreditsForPayment(
  supabase: SupabaseClient,
  params: {
    userId: string
    credits: number
    paymentId: string
    amountDollars: number
    metadata?: Record<string, unknown>
  },
): Promise<number> {
  const { data, error } = await supabase.rpc('add_lead_credits', {
    p_user_id: params.userId,
    p_credits: params.credits,
    p_external_id: `dodo:${params.paymentId}`,
    p_reason: 'purchase',
    p_metadata: {
      amount_dollars: params.amountDollars,
      credits_per_dollar: getLeadCreditsPerDollar(),
      ...(params.metadata ?? {}),
    },
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function grantStarterLeadCredits(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('add_lead_credits', {
    p_user_id: userId,
    p_credits: STARTER_LEAD_CREDITS,
    p_external_id: `starter:${userId}`,
    p_reason: 'starter',
    p_metadata: { source: 'signup' },
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function consumeLeadCredit(
  supabase: SupabaseClient,
  params: {
    userId: string
    leadId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc('consume_lead_credit', {
    p_user_id: params.userId,
    p_lead_id: params.leadId ?? null,
    p_reason: 'consume',
    p_metadata: params.metadata ?? {},
  })
  if (error) throw new Error(error.message)
  return Boolean(data)
}

export async function refundLeadCredit(
  supabase: SupabaseClient,
  params: {
    userId: string
    leadId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase.rpc('refund_lead_credit', {
    p_user_id: params.userId,
    p_lead_id: params.leadId ?? null,
    p_metadata: params.metadata ?? {},
  })
  if (error) throw new Error(error.message)
}
