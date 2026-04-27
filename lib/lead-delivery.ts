import type { PlanTier } from '@/lib/plan'

const DEDUPE_WINDOW_HOURS = 72
const DELIVERY_DAY_SLICES = 8

const SOURCE_PRIORITY: Record<string, number> = {
  company_owned: 42,
  job_board: 32,
  prnewswire: 24,
  businesswire: 24,
  globenewswire: 22,
  product_hunt: 16,
  hacker_news: 14,
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
}): number {
  const recencyAgeHours = params.publishedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(params.publishedAt).getTime()) / (60 * 60 * 1000)))
    : 0
  const recencyBoost = Math.max(0, 72 - recencyAgeHours)
  const sourceBoost = SOURCE_PRIORITY[params.sourceName ?? ''] ?? 6
  const watchlistBoost = params.isWatchlisted ? 40 : 0
  const keywordBoost = params.keywordMatched ? 12 : 0

  return (params.relevanceScore * 100) + recencyBoost + sourceBoost + watchlistBoost + keywordBoost
}

export function computeDeliveryAllowance(params: {
  plan: PlanTier
  monthlyLimit: number
  used: number
  creditBalance?: number
  pendingCount: number
  deliveredLast24h: number
}): number {
  if (params.pendingCount <= 0) return 0

  if (params.plan === 'free') {
    const targetDaily = Math.max(8, Math.ceil(params.pendingCount / 12))
    const remainingToday = Math.max(0, targetDaily - params.deliveredLast24h)
    if (remainingToday <= 0) return 0
    return Math.min(6, Math.max(1, Math.ceil(remainingToday / DELIVERY_DAY_SLICES)))
  }

  const remainingQuota = Math.max(0, params.monthlyLimit - params.used)
  const availableUnlocks = remainingQuota + Math.max(0, params.creditBalance ?? 0)
  if (availableUnlocks <= 0) return 0

  return Math.min(params.pendingCount, availableUnlocks)
}

export function nextQuotaRetryAt(date = new Date()): string {
  const retryAt = new Date(date)
  retryAt.setHours(retryAt.getHours() + 6)
  return retryAt.toISOString()
}
