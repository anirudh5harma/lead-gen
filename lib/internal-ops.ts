import type { SupabaseClient } from '@supabase/supabase-js'
import { computeLeadFeedbackScore, getFeedbackWindowStart } from '@/lib/ranking-feedback'
import {
  buildWeeklyReview,
  type InternalOpsReviewLeadRow,
  type InternalOpsReviewQueueRow,
  type InternalOpsReviewSignalRow,
  type WeeklyReview,
} from '@/lib/internal-ops-review'

type InternalOpsLeadRow = InternalOpsReviewLeadRow
type InternalOpsQueueRow = InternalOpsReviewQueueRow
type InternalOpsSignalRow = InternalOpsReviewSignalRow

interface CronMetricsRow {
  job_name: string
  metrics?: Record<string, unknown> | null
}

export interface InternalOpsSummary {
  generated_at: string
  weekly_review: WeeklyReview
  funnel_30d: {
    queued: number
    delivered: number
    unlocked: number
    sent: number
    replied: number
    booked: number
    dismissed: number
  }
  queue_health: {
    pending_now: number
    due_now: number
    delivered_30d: number
    expired_30d: number
    duplicate_30d: number
    avg_attempts_pending: number
  }
  monitored_accounts: {
    total: number
    watchlist_seeded: number
    polled_7d: number
    signaled_7d: number
  }
  source_yield_30d: Array<{
    source: string
    signals: number
    queued: number
    delivered: number
    unlocked: number
    sent: number
    replied: number
    booked: number
  }>
  signal_type_yield_30d: Array<{
    signal_type: string
    delivered: number
    sent: number
    replied: number
    booked: number
  }>
  feedback: {
    companies: Array<{ label: string; score: number }>
    signal_types: Array<{ label: string; score: number }>
    sources: Array<{ label: string; score: number }>
  }
  cron_30d: {
    poll_signals: {
      runs: number
      inserted: number
      monitored_seeded: number
      monitored_selected: number
    }
    match_leads: {
      runs: number
      ann_candidates: number
      candidate_pool_kept: number
      scored_by_claude: number
      queued: number
    }
    deliver_leads: {
      runs: number
      delivered: number
      preview_delivered: number
      overage_delivered: number
      feedback_reordered: number
    }
  }
}

export async function getInternalOpsSummary(
  supabase: SupabaseClient,
): Promise<InternalOpsSummary> {
  const now = new Date()
  const nowIso = now.toISOString()
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const feedbackWindow = getFeedbackWindowStart(now)

  const [
    leadRowsRes,
    queueRowsRes,
    signalRowsRes,
    cronRowsRes,
    monitoredTotalRes,
    monitoredWatchlistRes,
    monitoredPolledRes,
    monitoredSignaledRes,
    pendingQueueRes,
    dueQueueRes,
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('client_id, target_company, company_domain, status, is_unlocked, created_at, unlocked_at, sent_at, replied_at, booked_at, signals(signal_type, source_name)')
      .gte('created_at', feedbackWindow),
    supabase
      .from('lead_delivery_queue')
      .select('id, queue_status, attempt_count, created_at, queued_at, delivered_at, last_attempted_at, source_name, priority_score')
      .gte('created_at', last30d),
    supabase
      .from('signals')
      .select('id, source_name, signal_type, published_at')
      .gte('published_at', last30d),
    supabase
      .from('cron_runs')
      .select('job_name, metrics')
      .in('job_name', ['poll_signals', 'match_leads', 'deliver_leads'])
      .gte('started_at', last30d),
    supabase
      .from('monitored_accounts')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('monitored_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('is_watchlist', true),
    supabase
      .from('monitored_accounts')
      .select('id', { count: 'exact', head: true })
      .gte('last_polled_at', last7d),
    supabase
      .from('monitored_accounts')
      .select('id', { count: 'exact', head: true })
      .gte('last_signal_at', last7d),
    supabase
      .from('lead_delivery_queue')
      .select('id', { count: 'exact', head: true })
      .eq('queue_status', 'pending'),
    supabase
      .from('lead_delivery_queue')
      .select('id', { count: 'exact', head: true })
      .eq('queue_status', 'pending')
      .lte('next_delivery_at', nowIso),
  ])

  const leadRows = (leadRowsRes.data ?? []) as InternalOpsLeadRow[]
  const queueRows = (queueRowsRes.data ?? []) as InternalOpsQueueRow[]
  const signalRows = (signalRowsRes.data ?? []) as InternalOpsSignalRow[]
  const cronRows = (cronRowsRes.data ?? []) as CronMetricsRow[]
  const leadRows30d = leadRows.filter(row => isWithinWindow(row.created_at, last30d, nowIso))
  const weeklyReview = buildWeeklyReview({
    now,
    leadRows,
    queueRows,
    signalRows,
  })

  const sourceYield = new Map<string, {
    source: string
    signals: number
    queued: number
    delivered: number
    unlocked: number
    sent: number
    replied: number
    booked: number
  }>()
  const signalTypeYield = new Map<string, {
    signal_type: string
    delivered: number
    sent: number
    replied: number
    booked: number
  }>()

  for (const row of signalRows) {
    if (!isWithinWindow(row.published_at, last30d, nowIso)) continue
    const source = row.source_name ?? 'unknown'
    const bucket = ensureSourceBucket(sourceYield, source)
    bucket.signals++
  }

  for (const row of queueRows) {
    if (!isWithinWindow(row.created_at ?? row.queued_at, last30d, nowIso)) continue
    const source = row.source_name ?? 'unknown'
    const bucket = ensureSourceBucket(sourceYield, source)
    bucket.queued++
    if (row.queue_status === 'delivered' && isWithinWindow(row.delivered_at, last30d, nowIso)) bucket.delivered++
  }

  const companyFeedback = new Map<string, number>()
  const signalTypeFeedback = new Map<string, number>()
  const sourceFeedback = new Map<string, number>()

  for (const row of leadRows30d) {
    const signal = Array.isArray(row.signals) ? row.signals[0] ?? null : row.signals
    const source = signal?.source_name ?? 'unknown'
    const sourceBucket = ensureSourceBucket(sourceYield, source)
    if (row.is_unlocked && isWithinWindow(row.unlocked_at ?? row.created_at, last30d, nowIso)) sourceBucket.unlocked++
    if (isWithinWindow(row.sent_at, last30d, nowIso)) sourceBucket.sent++
    if (isWithinWindow(row.replied_at, last30d, nowIso)) sourceBucket.replied++
    if (isWithinWindow(row.booked_at, last30d, nowIso)) sourceBucket.booked++

    const signalType = signal?.signal_type ?? 'unknown'
    const typeBucket = ensureSignalTypeBucket(signalTypeYield, signalType)
    typeBucket.delivered++
    if (isWithinWindow(row.sent_at, last30d, nowIso)) typeBucket.sent++
    if (isWithinWindow(row.replied_at, last30d, nowIso)) typeBucket.replied++
    if (isWithinWindow(row.booked_at, last30d, nowIso)) typeBucket.booked++
  }

  for (const row of leadRows) {
    const signal = Array.isArray(row.signals) ? row.signals[0] ?? null : row.signals
    const source = signal?.source_name ?? 'unknown'
    const signalType = signal?.signal_type ?? 'unknown'

    const feedbackScore = computeLeadFeedbackScore(row)
    if (feedbackScore !== 0) {
      companyFeedback.set(row.target_company, (companyFeedback.get(row.target_company) ?? 0) + feedbackScore)
      signalTypeFeedback.set(signalType, (signalTypeFeedback.get(signalType) ?? 0) + feedbackScore)
      sourceFeedback.set(source, (sourceFeedback.get(source) ?? 0) + feedbackScore)
    }
  }

  const funnel30d = {
    queued: queueRows.filter(row => isWithinWindow(row.created_at ?? row.queued_at, last30d, nowIso)).length,
    delivered: queueRows.filter(row => row.queue_status === 'delivered' && isWithinWindow(row.delivered_at, last30d, nowIso)).length,
    unlocked: leadRows30d.filter(row => row.is_unlocked && isWithinWindow(row.unlocked_at ?? row.created_at, last30d, nowIso)).length,
    sent: leadRows30d.filter(row => isWithinWindow(row.sent_at, last30d, nowIso)).length,
    replied: leadRows30d.filter(row => isWithinWindow(row.replied_at, last30d, nowIso)).length,
    booked: leadRows30d.filter(row => isWithinWindow(row.booked_at, last30d, nowIso)).length,
    dismissed: leadRows30d.filter(row => row.status === 'dismissed').length,
  }

  const pendingRows30d = queueRows.filter(row => row.queue_status === 'pending')
  const avgAttemptsPending = pendingRows30d.length > 0
    ? pendingRows30d.reduce((sum, row) => sum + row.attempt_count, 0) / pendingRows30d.length
    : 0

  return {
    generated_at: nowIso,
    weekly_review: weeklyReview,
    funnel_30d: funnel30d,
    queue_health: {
      pending_now: pendingQueueRes.count ?? 0,
      due_now: dueQueueRes.count ?? 0,
      delivered_30d: queueRows.filter(row => row.queue_status === 'delivered').length,
      expired_30d: queueRows.filter(row => row.queue_status === 'expired').length,
      duplicate_30d: queueRows.filter(row => row.queue_status === 'duplicate').length,
      avg_attempts_pending: Number(avgAttemptsPending.toFixed(2)),
    },
    monitored_accounts: {
      total: monitoredTotalRes.count ?? 0,
      watchlist_seeded: monitoredWatchlistRes.count ?? 0,
      polled_7d: monitoredPolledRes.count ?? 0,
      signaled_7d: monitoredSignaledRes.count ?? 0,
    },
    source_yield_30d: [...sourceYield.values()]
      .sort((a, b) => b.booked - a.booked || b.replied - a.replied || b.queued - a.queued)
      .slice(0, 12),
    signal_type_yield_30d: [...signalTypeYield.values()]
      .sort((a, b) => b.booked - a.booked || b.replied - a.replied || b.delivered - a.delivered),
    feedback: {
      companies: topFeedbackEntries(companyFeedback, 8),
      signal_types: topFeedbackEntries(signalTypeFeedback, 6),
      sources: topFeedbackEntries(sourceFeedback, 6),
    },
    cron_30d: {
      poll_signals: sumCronMetrics(cronRows, 'poll_signals', {
        runs: 0,
        inserted: 0,
        monitored_seeded: 0,
        monitored_selected: 0,
      }, metric => {
        const stats = asRecord(metric.stats)
        return {
          runs: 1,
          inserted: num(metric.inserted),
          monitored_seeded: num(stats.monitored_accounts_seeded),
          monitored_selected: num(stats.monitored_accounts_selected),
        }
      }),
      match_leads: sumCronMetrics(cronRows, 'match_leads', {
        runs: 0,
        ann_candidates: 0,
        candidate_pool_kept: 0,
        scored_by_claude: 0,
        queued: 0,
      }, metric => {
        const stats = asRecord(metric.stats)
        return {
          runs: 1,
          ann_candidates: num(stats.ann_candidates),
          candidate_pool_kept: num(stats.candidate_pool_kept),
          scored_by_claude: num(stats.scored_by_claude),
          queued: num(metric.queued),
        }
      }),
      deliver_leads: sumCronMetrics(cronRows, 'deliver_leads', {
        runs: 0,
        delivered: 0,
        preview_delivered: 0,
        overage_delivered: 0,
        feedback_reordered: 0,
      }, metric => ({
        runs: 1,
        delivered: num(metric.delivered),
        preview_delivered: num(metric.preview_delivered),
        overage_delivered: num(metric.overage_delivered),
        feedback_reordered: num(metric.feedback_reordered),
      })),
    },
  }
}

function ensureSourceBucket(
  map: Map<string, {
    source: string
    signals: number
    queued: number
    delivered: number
    unlocked: number
    sent: number
    replied: number
    booked: number
  }>,
  source: string,
) {
  const existing = map.get(source)
  if (existing) return existing
  const bucket = {
    source,
    signals: 0,
    queued: 0,
    delivered: 0,
    unlocked: 0,
    sent: 0,
    replied: 0,
    booked: 0,
  }
  map.set(source, bucket)
  return bucket
}

function ensureSignalTypeBucket(
  map: Map<string, {
    signal_type: string
    delivered: number
    sent: number
    replied: number
    booked: number
  }>,
  signalType: string,
) {
  const existing = map.get(signalType)
  if (existing) return existing
  const bucket = {
    signal_type: signalType,
    delivered: 0,
    sent: 0,
    replied: 0,
    booked: 0,
  }
  map.set(signalType, bucket)
  return bucket
}

function topFeedbackEntries(map: Map<string, number>, limit: number): Array<{ label: string; score: number }> {
  return [...map.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([label, score]) => ({
      label,
      score: Number(score.toFixed(2)),
    }))
}

function sumCronMetrics<T extends Record<string, number>>(
  rows: CronMetricsRow[],
  jobName: string,
  seed: T,
  pick: (metric: Record<string, unknown>) => T,
): T {
  const result: Record<string, number> = { ...seed }
  for (const row of rows) {
    if (row.job_name !== jobName) continue
    const picked = pick((row.metrics ?? {}) as Record<string, unknown>)
    for (const [key, value] of Object.entries(picked)) {
      result[key] = (result[key] ?? 0) + value
    }
  }
  return result as T
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function isWithinWindow(value: string | null | undefined, startIso: string, endIso: string): boolean {
  if (!value) return false
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  return timestamp >= Date.parse(startIso) && timestamp < Date.parse(endIso)
}
