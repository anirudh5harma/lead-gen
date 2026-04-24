const FAILED_COMPANY_RETRY_DAYS = 21

export type CachedResolutionMethod = 'direct' | 'pattern' | 'role' | null

export interface CachedContactComparisonRow {
  contact_verified: boolean
  base_score: number
  resolution_method: CachedResolutionMethod
  enriched_at: string
}

export interface CompanyEnrichmentCacheSnapshot {
  input_domain: string | null
  resolved_domain: string | null
  last_succeeded_at: string | null
  last_failed_at: string | null
}

function resolutionMethodRank(method: CachedResolutionMethod): number {
  if (method === 'direct') return 3
  if (method === 'pattern') return 2
  if (method === 'role') return 1
  return 0
}

export function compareCachedContactRows(
  a: CachedContactComparisonRow,
  b: CachedContactComparisonRow,
): number {
  if (a.contact_verified !== b.contact_verified) {
    return a.contact_verified ? 1 : -1
  }

  const methodDelta = resolutionMethodRank(a.resolution_method) - resolutionMethodRank(b.resolution_method)
  if (methodDelta !== 0) return methodDelta

  const baseScoreDelta = (a.base_score ?? 0) - (b.base_score ?? 0)
  if (baseScoreDelta !== 0) return baseScoreDelta

  return Date.parse(a.enriched_at) - Date.parse(b.enriched_at)
}

function normalizeDomainValue(domain: string | null | undefined): string | null {
  const normalized = domain
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]

  return normalized && normalized.includes('.') ? normalized : null
}

export function shouldShortCircuitEnrichmentFailure(params: {
  cache: CompanyEnrichmentCacheSnapshot | null
  companyDomain: string | null
  now?: Date
}): boolean {
  const { cache, companyDomain } = params
  if (!cache?.last_failed_at) return false

  const failureCutoff = new Date(
    (params.now ?? new Date()).getTime() - FAILED_COMPANY_RETRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  if (cache.last_failed_at < failureCutoff) return false

  if (cache.last_succeeded_at) return false

  const incomingDomain = normalizeDomainValue(companyDomain)
  const cachedInputDomain = normalizeDomainValue(cache.input_domain)
  const cachedResolvedDomain = normalizeDomainValue(cache.resolved_domain)

  if (incomingDomain && incomingDomain !== cachedInputDomain && incomingDomain !== cachedResolvedDomain) {
    return false
  }

  return true
}

export function isCandidateSafeWithoutVerification(params: {
  zeroBounceEnabled: boolean
  resolutionMethod: 'direct' | 'pattern' | 'role'
}): boolean {
  return !params.zeroBounceEnabled && params.resolutionMethod === 'direct'
}
