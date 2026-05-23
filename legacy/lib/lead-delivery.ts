const DEDUPE_WINDOW_HOURS = 72
const DELIVERY_DAY_SLICES = 6

const SOURCE_PRIORITY: Record<string, number> = {
  company_owned: 42,
  job_board: 32,
  prnewswire: 24,
  businesswire: 24,
  globenewswire: 22,
  product_hunt: 16,
  hacker_news: 14,
  finsmes: 20,
  techcrunch_startups: 18,
  techcrunch_enterprise: 17,
  securityweek: 17,
  the_hacker_news: 17,
  sec_press: 17,
  eu_startups: 15,
  venturebeat_ai: 15,
  siliconangle: 13,
  google_news_company: 14,
  gdelt: 10,
  google_news: 8,
}

export function queueExpiryFromPublishedAt(publishedAt?: string | null): string {
  const base = publishedAt ? new Date(publishedAt) : new Date()
  base.setHours(base.getHours() + DEDUPE_WINDOW_HOURS)
  return base.toISOString()
}

export function computeQueuePriority(params: {
  relevanceScore: number
  publishedAt?: string | null
  sourceName?: string | null
  isWatchlisted?: boolean
  keywordMatched?: boolean
  clusterScore?: number | null
  corroboratingSourceCount?: number | null
}): number {
  const recencyAgeHours = params.publishedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(params.publishedAt).getTime()) / (60 * 60 * 1000)))
    : 0
  const recencyBoost = Math.max(0, 72 - recencyAgeHours)
  const sourceBoost = SOURCE_PRIORITY[params.sourceName ?? ''] ?? 6
  const clusterBoost = Math.max(0, Math.min(55, Math.round((params.clusterScore ?? 0) * 0.55)))
  const corroborationBoost = Math.max(0, Math.min(30, ((params.corroboratingSourceCount ?? 1) - 1) * 15))
  const watchlistBoost = params.isWatchlisted ? 40 : 0
  const keywordBoost = params.keywordMatched ? 12 : 0

  return (params.relevanceScore * 100) + recencyBoost + sourceBoost + clusterBoost + corroborationBoost + watchlistBoost + keywordBoost
}

export function computeDeliveryAllowance(params: {
  pendingCount: number
  deliveredLast24h: number
}): number {
  if (params.pendingCount <= 0) return 0

  const targetDaily = Math.min(80, Math.max(16, Math.ceil(params.pendingCount / 6)))
  const remainingToday = Math.max(0, targetDaily - params.deliveredLast24h)
  if (remainingToday <= 0) return 0
  return Math.min(12, Math.max(1, Math.ceil(remainingToday / DELIVERY_DAY_SLICES)))
}

export function nextQuotaRetryAt(date = new Date()): string {
  const retryAt = new Date(date)
  retryAt.setHours(retryAt.getHours() + 6)
  return retryAt.toISOString()
}
