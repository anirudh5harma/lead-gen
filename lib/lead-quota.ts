import type { PlanTier } from '@/lib/plan'

export type LeadQuotaDecision = 'reserve' | 'credit' | 'preview' | 'blocked'

export function resolveLeadQuotaDecision(params: {
  used: number
  monthlyLimit: number
  creditBalance?: number
  plan: PlanTier
}): LeadQuotaDecision {
  const { used, monthlyLimit, creditBalance = 0, plan } = params

  if (used < monthlyLimit) {
    return 'reserve'
  }

  if (creditBalance > 0) {
    return 'credit'
  }

  if (plan === 'free') {
    return 'preview'
  }

  return 'blocked'
}
