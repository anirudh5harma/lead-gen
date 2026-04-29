import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_CREDITS_PER_DOLLAR = 4

export const CREDIT_TOP_UP_AMOUNTS = [5, 20, 50, 100] as const
export const STARTER_LEAD_CREDITS = 20

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
