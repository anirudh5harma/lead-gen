'use client'

import { useEffect, useMemo, useState } from 'react'
import type { GtmInsight } from './types'

interface InsightsPayload {
  insights: GtmInsight[]
  metrics: Record<string, number>
}

const TYPE_LABELS: Record<string, string> = {
  source_gap: 'Source gap',
  source_waste: 'Source waste',
  source_winner: 'Source winner',
  persona_winner: 'Persona winner',
  reply_pattern: 'Reply pattern',
  content_opportunity: 'Content',
  coverage_gap: 'Coverage',
  stale_contact_risk: 'Contact risk',
  automation_safety: 'Safety',
  pipeline_movement: 'Pipeline',
}

export default function InsightsView() {
  const [payload, setPayload] = useState<InsightsPayload>({ insights: [], metrics: {} })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/gtm/insights?limit=50')
    const data = await res.json().catch(() => null) as InsightsPayload & { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not load insights.')
    else setPayload({ insights: data?.insights ?? [], metrics: data?.metrics ?? {} })
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const openInsights = useMemo(
    () => payload.insights.filter(insight => insight.status !== 'dismissed' && insight.status !== 'archived'),
    [payload.insights],
  )

  async function act(insightId: string, action: 'action' | 'dismiss') {
    setBusyId(insightId)
    setError(null)
    const res = await fetch('/api/gtm/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insight_id: insightId, action }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) setError(data?.error ?? 'Could not update insight.')
    await load()
    setBusyId(null)
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Open" value={payload.metrics.open ?? 0} />
        <Metric label="High impact" value={payload.metrics.high_impact ?? 0} />
        <Metric label="Actioned" value={payload.metrics.actioned ?? 0} />
        <Metric label="Content" value={payload.metrics.content_opportunities ?? 0} />
      </section>

      {error && (
        <div className="rounded-lg border border-[var(--color-sig-regulation)]/25 bg-[var(--color-sig-regulation)]/8 px-4 py-3 text-[13px] text-[var(--color-sig-regulation)]">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--color-text-1)]">Recommendations</h2>
            <p className="text-[12px] text-[var(--color-text-3)]">Generated from sources, outcomes, content, contacts, and pipeline movement.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="h-8 px-3 rounded-lg border border-[var(--color-line-1)] bg-white text-[12px] font-semibold text-[var(--color-text-2)] hover:text-[var(--color-text-1)] disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <EmptyState text="Loading insights." />
        ) : openInsights.length === 0 ? (
          <EmptyState text="No open insights yet. Recommendations will appear once Bombsell has enough signal, source, and workflow data." />
        ) : (
          <div className="grid gap-3">
            {openInsights.map(insight => (
              <article
                key={insight.id}
                className="rounded-lg border border-[var(--color-line-1)] bg-white shadow-[0_1px_2px_#00000008] overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-accent-ring)]">
                      {TYPE_LABELS[insight.insight_type] ?? insight.insight_type.replace(/_/g, ' ')}
                    </span>
                    <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-text-3)]">
                      impact {insight.impact_score}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-3)]">
                      {Math.round(insight.confidence * 100)}% confidence
                    </span>
                  </div>

                  <h3 className="mt-3 text-[14px] font-semibold leading-snug text-[var(--color-text-1)]">{insight.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-2)]">{insight.summary}</p>

                  {insight.evidence.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {insight.evidence.slice(0, 3).map(item => (
                        <div key={`${insight.id}:${item.label}`} className="rounded-md bg-[var(--color-ink-2)] px-3 py-2">
                          <p className="text-[10.5px] font-semibold uppercase text-[var(--color-text-3)]">{item.label}</p>
                          <p className="mt-1 text-[12px] leading-snug text-[var(--color-text-2)] line-clamp-2">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-4 py-3">
                  <button
                    onClick={() => act(insight.id, 'action')}
                    disabled={busyId === insight.id || insight.status === 'actioned'}
                    className="h-8 px-3 rounded-lg btn-primary text-[12px] font-semibold disabled:opacity-50"
                  >
                    {insight.status === 'actioned' ? 'Action created' : 'Create action'}
                  </button>
                  <button
                    onClick={() => act(insight.id, 'dismiss')}
                    disabled={busyId === insight.id}
                    className="h-8 px-3 rounded-lg text-[12px] font-semibold text-[var(--color-text-3)] hover:bg-white hover:text-[var(--color-text-1)] disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <span className="ml-auto text-[11px] text-[var(--color-text-3)]">{insight.recommended_action_type.replace(/_/g, ' ')}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-8 text-center text-[13px] text-[var(--color-text-3)]">
      {text}
    </div>
  )
}
