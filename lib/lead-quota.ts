import type { PlanTier } from '@/lib/plan'

export type LeadQuotaDecision = 'reserve' | 'overage' | 'preview' | 'blocked'

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

  if (plan === 'free') {
    return 'preview'
  }

  if (allowLeadOverage) {
    return 'overage'
  }

  return 'blocked'
}
