import type { PlanTier } from '@/lib/plan'

export type LeadQuotaDecision = 'reserve' | 'overage' | 'blocked'

export function resolveLeadQuotaDecision(params: {
  used: number
  monthlyLimit: number
  allowLeadOverage: boolean
  plan: PlanTier
}): LeadQuotaDecision {
  const { used, monthlyLimit, allowLeadOverage, plan } = params

  if (used < monthlyLimit) {
    return 'reserve'
  }

  if (allowLeadOverage && plan !== 'free') {
    return 'overage'
  }

  return 'blocked'
}
