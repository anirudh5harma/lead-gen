export interface InternalOpsReviewLeadRow {
  client_id: string | null
  target_company: string
  company_domain?: string | null
  status: string
  is_unlocked?: boolean | null
  created_at?: string | null
  unlocked_at?: string | null
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
  signals?: { signal_type?: string | null; source_name?: string | null } | Array<{ signal_type?: string | null; source_name?: string | null }> | null
}

export interface InternalOpsReviewQueueRow {
  id: string
  queue_status: string
  attempt_count: number
  created_at?: string | null
  queued_at?: string | null
  delivered_at?: string | null
  last_attempted_at?: string | null
  source_name?: string | null
  priority_score: number
}

export interface InternalOpsReviewSignalRow {
  id: string
  source_name?: string | null
  signal_type: string
  published_at?: string | null
}

interface WeeklyReviewMetrics {
  signals: number
  queued: number
  delivered: number
  unlocked: number
  sent: number
  replied: number
  booked: number
  expired: number
}

export interface WeeklyReview {
  current_period_start: string
  previous_period_start: string
  current: WeeklyReviewMetrics
  previous: WeeklyReviewMetrics
  deltas: WeeklyReviewMetrics
  top_sources: Array<{
    source: string
    delivered: number
    replied: number
    booked: number
  }>
  recommendations: string[]
}

export function buildWeeklyReview(params: {
  now?: Date
  leadRows: InternalOpsReviewLeadRow[]
  queueRows: InternalOpsReviewQueueRow[]
  signalRows: InternalOpsReviewSignalRow[]
}): WeeklyReview {
  const now = params.now ?? new Date()
  const currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const previousStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const nowIso = now.toISOString()
  const currentStartIso = currentStart.toISOString()
  const previousStartIso = previousStart.toISOString()

  const current: WeeklyReviewMetrics = {
    signals: params.signalRows.filter(row => isWithinWindow(row.published_at, currentStartIso, nowIso)).length,
    queued: params.queueRows.filter(row => isWithinWindow(row.created_at ?? row.queued_at, currentStartIso, nowIso)).length,
    delivered: params.queueRows.filter(row => isWithinWindow(row.delivered_at, currentStartIso, nowIso)).length,
    unlocked: params.leadRows.filter(row => row.is_unlocked && isWithinWindow(row.unlocked_at ?? row.created_at, currentStartIso, nowIso)).length,
    sent: params.leadRows.filter(row => isWithinWindow(row.sent_at, currentStartIso, nowIso)).length,
    replied: params.leadRows.filter(row => isWithinWindow(row.replied_at, currentStartIso, nowIso)).length,
    booked: params.leadRows.filter(row => isWithinWindow(row.booked_at, currentStartIso, nowIso)).length,
    expired: params.queueRows.filter(row => row.queue_status === 'expired' && isWithinWindow(row.last_attempted_at, currentStartIso, nowIso)).length,
  }

  const previous: WeeklyReviewMetrics = {
    signals: params.signalRows.filter(row => isWithinWindow(row.published_at, previousStartIso, currentStartIso)).length,
    queued: params.queueRows.filter(row => isWithinWindow(row.created_at ?? row.queued_at, previousStartIso, currentStartIso)).length,
    delivered: params.queueRows.filter(row => isWithinWindow(row.delivered_at, previousStartIso, currentStartIso)).length,
    unlocked: params.leadRows.filter(row => row.is_unlocked && isWithinWindow(row.unlocked_at ?? row.created_at, previousStartIso, currentStartIso)).length,
    sent: params.leadRows.filter(row => isWithinWindow(row.sent_at, previousStartIso, currentStartIso)).length,
    replied: params.leadRows.filter(row => isWithinWindow(row.replied_at, previousStartIso, currentStartIso)).length,
    booked: params.leadRows.filter(row => isWithinWindow(row.booked_at, previousStartIso, currentStartIso)).length,
    expired: params.queueRows.filter(row => row.queue_status === 'expired' && isWithinWindow(row.last_attempted_at, previousStartIso, currentStartIso)).length,
  }

  const sourceStats = new Map<string, { source: string; delivered: number; replied: number; booked: number }>()
  for (const row of params.leadRows) {
    if (!isWithinWindow(row.created_at, currentStartIso, nowIso)) continue
    const signal = Array.isArray(row.signals) ? row.signals[0] ?? null : row.signals
    const source = signal?.source_name ?? 'unknown'
    const bucket = sourceStats.get(source) ?? { source, delivered: 0, replied: 0, booked: 0 }
    bucket.delivered++
    if (isWithinWindow(row.replied_at, currentStartIso, nowIso)) bucket.replied++
    if (isWithinWindow(row.booked_at, currentStartIso, nowIso)) bucket.booked++
    sourceStats.set(source, bucket)
  }

  return {
    current_period_start: currentStartIso,
    previous_period_start: previousStartIso,
    current,
    previous,
    deltas: diffMetrics(current, previous),
    top_sources: [...sourceStats.values()]
      .sort((a, b) => b.booked - a.booked || b.replied - a.replied || b.delivered - a.delivered)
      .slice(0, 5),
    recommendations: buildWeeklyRecommendations(current, previous, [...sourceStats.values()]),
  }
}

function diffMetrics(current: WeeklyReviewMetrics, previous: WeeklyReviewMetrics): WeeklyReviewMetrics {
  return {
    signals: current.signals - previous.signals,
    queued: current.queued - previous.queued,
    delivered: current.delivered - previous.delivered,
    unlocked: current.unlocked - previous.unlocked,
    sent: current.sent - previous.sent,
    replied: current.replied - previous.replied,
    booked: current.booked - previous.booked,
    expired: current.expired - previous.expired,
  }
}

function buildWeeklyRecommendations(
  current: WeeklyReviewMetrics,
  previous: WeeklyReviewMetrics,
  sources: Array<{ source: string; delivered: number; replied: number; booked: number }>,
): string[] {
  const recommendations: string[] = []

  if (current.signals < Math.max(12, Math.floor(previous.signals * 0.8))) {
    recommendations.push('Signal supply is down week over week. Increase monitored-account breadth or relax source-side shortlist rules before changing delivery pacing.')
  }

  if (current.queued < Math.max(8, Math.floor(current.signals * 0.18))) {
    recommendations.push('Too few fresh signals are making it into the queue. Review similarity floors, min relevance thresholds, and watchlist coverage.')
  }

  if (current.expired > 0 && current.expired >= Math.max(2, current.delivered * 0.1)) {
    recommendations.push('Queue expiry is burning usable inventory. Either speed up delivery for high-priority rows or extend expiry for slower-moving segments.')
  }

  if (current.delivered > 0 && current.replied === 0) {
    recommendations.push('Delivery volume is landing without replies. Recheck source weighting and feedback boosts before widening the queue further.')
  }

  const bestSource = [...sources]
    .sort((a, b) => b.booked - a.booked || b.replied - a.replied || b.delivered - a.delivered)[0]
  if (bestSource && (bestSource.booked > 0 || bestSource.replied > 0)) {
    recommendations.push(`Best source this week is ${bestSource.source}. Consider increasing its priority weight or monitored-account coverage in the next tuning pass.`)
  }

  if (recommendations.length === 0) {
    recommendations.push('Volume and downstream engagement are stable this week. Keep weights steady and watch for source mix drift before making threshold changes.')
  }

  return recommendations
}

function isWithinWindow(value: string | null | undefined, startIso: string, endIso: string): boolean {
  if (!value) return false
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  return timestamp >= Date.parse(startIso) && timestamp < Date.parse(endIso)
}
