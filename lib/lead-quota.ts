export type LeadQuotaDecision = 'reserve' | 'credit' | 'preview' | 'blocked'

export function resolveLeadQuotaDecision(params: {
  used: number
  monthlyLimit: number
  creditBalance?: number
}): LeadQuotaDecision {
  const { creditBalance = 0 } = params

  if (creditBalance > 0) {
    return 'credit'
  }

  return 'preview'
}
