'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CoverageRecommendation } from './types'
import { TabLoadingState } from './shared'

export default function CoverageView() {
  const [coverage, setCoverage] = useState<CoverageRecommendation[]>([])
  const [coverageMetrics, setCoverageMetrics] = useState<Record<string, number>>({})
  const [coverageLoaded, setCoverageLoaded] = useState(false)
  const [coverageBusyId, setCoverageBusyId] = useState<string | null>(null)

  const loadCoverage = useCallback(async () => {
    setCoverageLoaded(false)
    const res = await fetch('/api/gtm/coverage?limit=20', { cache: 'no-store' }).catch(() => null)
    const data = await res?.json().catch(() => null) as { recommendations?: CoverageRecommendation[]; metrics?: Record<string, number> } | null
    setCoverage(data?.recommendations ?? [])
    setCoverageMetrics(data?.metrics ?? {})
    setCoverageLoaded(true)
  }, [])

  useEffect(() => {
    loadCoverage()
  }, [loadCoverage])

  const updateCoverage = useCallback(async (recommendationId: string, action: 'apply' | 'dismiss') => {
    setCoverageBusyId(recommendationId)
    try {
      await fetch('/api/gtm/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: recommendationId, action }),
      })
      await loadCoverage()
    } finally {
      setCoverageBusyId(null)
    }
  }, [loadCoverage])

  if (!coverageLoaded) return <TabLoadingState title="Loading Coverage" detail="Analyzing signal sources and feed economics." />

  return (
    <div className="w-full space-y-4">
      {/* Metrics */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Open" value={coverageMetrics.open ?? 0} />
        <Metric label="Add feed" value={coverageMetrics.add_feed ?? 0} />
        <Metric label="Applied" value={coverageMetrics.applied ?? 0} />
        <Metric label="Sources" value={coverageMetrics.sources ?? 0} />
      </section>

      {/* Recommendations */}
      <div className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-[var(--color-text-1)]">Coverage Optimization</h3>
            <p className="text-[11.5px] text-[var(--color-text-3)]">Source priority and feed suggestions from recent signal economics.</p>
          </div>
          <button
            onClick={loadCoverage}
            className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] transition-colors"
          >
            Refresh
          </button>
        </div>
        {coverage.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-[var(--color-text-3)]">
            No coverage recommendations yet. The optimizer needs recent source-run and lead data.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)]">
            {coverage.filter(item => item.status !== 'dismissed').map(item => (
              <li key={item.id} className="px-5 py-4">
                <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-accent-ring)]">
                        {item.recommendation_type.replace(/_/g, ' ')}
                      </span>
                      <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-text-3)]">
                        impact {item.expected_impact}
                      </span>
                      <span className="text-[10.5px] text-[var(--color-text-3)]">
                        est. ${item.estimated_cost_usd.toFixed(4)}
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] font-semibold text-[var(--color-text-1)]">{item.title}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-2)]">{item.summary}</p>
                    {item.evidence.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.evidence.slice(0, 3).map(point => (
                          <span key={`${item.id}:${point.label}`} className="rounded-md bg-[var(--color-ink-2)] px-2.5 py-1 text-[10.5px] text-[var(--color-text-3)]">
                            <span className="font-semibold text-[var(--color-text-2)]">{point.label}:</span> {point.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => updateCoverage(item.id, 'apply')}
                      disabled={coverageBusyId === item.id || item.status === 'applied'}
                      className="h-8 px-3 rounded-lg btn-primary text-[12px] font-semibold disabled:opacity-50"
                    >
                      {item.status === 'applied' ? 'Applied' : 'Apply'}
                    </button>
                    <button
                      onClick={() => updateCoverage(item.id, 'dismiss')}
                      disabled={coverageBusyId === item.id}
                      className="h-8 px-3 rounded-lg text-[12px] font-semibold text-[var(--color-text-3)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)] disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase text-[var(--color-text-3)]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-text-1)]">{value}</p>
    </div>
  )
}
