import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySourceType, estimateSourceCost, type SourceType } from './signal-filter'
import { eventIdempotencyKey, recordGtmEvent } from './gtm/events'
import { upsertGtmSource } from './gtm/sources'

export interface SourceLedgerMetrics {
  sourceName: string
  sourceType: SourceType
  fetched: number
  rawCandidates: number
  filterPassed: number
  filterRejected: number
  extractionSuccess: number
  extractionNull: number
  extractionErrors: number
  duplicates: number
  insertedSignals: number
  estimatedCost: number
}

export class SourceLedger {
  private metrics = new Map<string, SourceLedgerMetrics>()

  addFetched(sourceName: string, count = 1): void {
    this.entry(sourceName).fetched += count
    this.entry(sourceName).estimatedCost += estimateSourceCost(sourceName) * count
  }

  addRawCandidate(sourceName: string): void {
    this.entry(sourceName).rawCandidates += 1
  }

  addFilterResult(sourceName: string, passed: boolean): void {
    if (passed) this.entry(sourceName).filterPassed += 1
    else this.entry(sourceName).filterRejected += 1
  }

  addExtractionOutcome(sourceName: string, outcome: 'success' | 'null' | 'error' | 'duplicate' | 'inserted'): void {
    const entry = this.entry(sourceName)
    if (outcome === 'success') entry.extractionSuccess += 1
    else if (outcome === 'null') entry.extractionNull += 1
    else if (outcome === 'error') entry.extractionErrors += 1
    else if (outcome === 'duplicate') entry.duplicates += 1
    else if (outcome === 'inserted') {
      entry.extractionSuccess += 1
      entry.insertedSignals += 1
    }
  }

  values(): SourceLedgerMetrics[] {
    return [...this.metrics.values()].sort((a, b) => b.insertedSignals - a.insertedSignals || b.filterPassed - a.filterPassed)
  }

  private entry(sourceName: string): SourceLedgerMetrics {
    const normalized = sourceName || 'unknown'
    const existing = this.metrics.get(normalized)
    if (existing) return existing

    const created: SourceLedgerMetrics = {
      sourceName: normalized,
      sourceType: classifySourceType(normalized),
      fetched: 0,
      rawCandidates: 0,
      filterPassed: 0,
      filterRejected: 0,
      extractionSuccess: 0,
      extractionNull: 0,
      extractionErrors: 0,
      duplicates: 0,
      insertedSignals: 0,
      estimatedCost: 0,
    }
    this.metrics.set(normalized, created)
    return created
  }
}

export async function recordSourceRunMetrics(
  supabase: SupabaseClient,
  input: {
    cronRunId?: string | null
    metrics: SourceLedgerMetrics[]
    startedAt?: string | null
    finishedAt?: string | null
  },
): Promise<void> {
  if (input.metrics.length === 0) return

  const startedAt = input.startedAt ?? new Date().toISOString()
  const finishedAt = input.finishedAt ?? new Date().toISOString()
  const rows = input.metrics.map(metric => ({
    cron_run_id: input.cronRunId ?? null,
    source_name: metric.sourceName,
    source_type: metric.sourceType,
    fetched_count: metric.fetched,
    raw_candidate_count: metric.rawCandidates,
    filter_passed_count: metric.filterPassed,
    filter_rejected_count: metric.filterRejected,
    extraction_success_count: metric.extractionSuccess,
    extraction_null_count: metric.extractionNull,
    extraction_error_count: metric.extractionErrors,
    duplicate_count: metric.duplicates,
    inserted_signal_count: metric.insertedSignals,
    estimated_cost_usd: Number(metric.estimatedCost.toFixed(6)),
    started_at: startedAt,
    finished_at: finishedAt,
  }))

  const { error } = await supabase.from('gtm_source_runs').insert(rows)
  if (error) {
    console.error('[source-ledger] insert failed:', error.message)
  }

  await Promise.all(input.metrics.map(metric => Promise.all([
    upsertGtmSource(supabase, {
      sourceName: metric.sourceName,
      sourceType: metric.sourceType,
      priority: sourcePriority(metric),
      attributes: {
        latest_run: {
          fetched: metric.fetched,
          raw_candidates: metric.rawCandidates,
          filter_passed: metric.filterPassed,
          filter_rejected: metric.filterRejected,
          inserted_signals: metric.insertedSignals,
          estimated_cost_usd: Number(metric.estimatedCost.toFixed(6)),
          finished_at: finishedAt,
        },
      },
    }),
    recordGtmEvent(supabase, {
      eventType: 'source.fetched',
      source: 'source_ledger',
      payload: {
        cron_run_id: input.cronRunId ?? null,
        source_name: metric.sourceName,
        source_type: metric.sourceType,
        fetched: metric.fetched,
        raw_candidates: metric.rawCandidates,
        filter_passed: metric.filterPassed,
        filter_rejected: metric.filterRejected,
        inserted_signals: metric.insertedSignals,
        estimated_cost_usd: Number(metric.estimatedCost.toFixed(6)),
      },
      idempotencyKey: eventIdempotencyKey(['source', input.cronRunId, metric.sourceName, finishedAt]),
    }),
  ])))
}

function sourcePriority(metric: SourceLedgerMetrics): number {
  if (metric.insertedSignals > 0) return 70
  if (metric.filterPassed > 0) return 58
  if (metric.fetched > 0 && metric.filterRejected >= metric.fetched) return 35
  return 50
}
