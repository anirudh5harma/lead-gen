'use client'

import { useState, useEffect } from 'react'
import type { Lead } from '@/lib/leads'
import { TabLoadingState } from './shared'

interface Props {
  leads: Lead[]
}

export default function AnalyticsView({ leads }: Props) {
  const [insights, setInsights] = useState<Array<{ insight_type: string; title: string; impact_score: number }>>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/gtm/insights?limit=10')
      .then(res => res.json().catch(() => null))
      .then((data: { insights?: Array<{ insight_type: string; title: string; impact_score: number }> } | null) => {
        if (cancelled) return
        setInsights(data?.insights ?? [])
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const [now] = useState(() => Date.now())
  const day = 24 * 60 * 60 * 1000
  const last7d = now - 7 * day
  const last30d = now - 30 * day
  const last90d = now - 90 * day

  const found7d = leads.filter(l => inWindow(l.created_at, last7d)).length
  const found30d = leads.filter(l => inWindow(l.created_at, last30d)).length

  const sent7d = leads.filter(l => inWindow(l.sent_at, last7d)).length
  const sent30d = leads.filter(l => inWindow(l.sent_at, last30d)).length

  const replied7d = leads.filter(l => inWindow(l.replied_at, last7d)).length
  const replied30d = leads.filter(l => inWindow(l.replied_at, last30d)).length

  const booked7d = leads.filter(l => inWindow(l.booked_at, last7d)).length
  const booked30d = leads.filter(l => inWindow(l.booked_at, last30d)).length
  const booked90d = leads.filter(l => inWindow(l.booked_at, last90d)).length

  const totalLeads = leads.length
  const dismissedCount = leads.filter(l => l.status === 'dismissed').length
  const engagedCount = leads.filter(l => l.status === 'sent' || l.status === 'replied' || l.status === 'booked').length

  // Conversion rates
  const foundToSent = found30d > 0 ? Math.round((sent30d / found30d) * 100) : 0
  const sentToReply = sent30d > 0 ? Math.round((replied30d / sent30d) * 100) : 0
  const replyToBooked = replied30d > 0 ? Math.round((booked30d / replied30d) * 100) : 0

  if (!loaded) return <TabLoadingState title="Loading Analytics" detail="Computing funnel metrics and conversion rates." />

  return (
    <div className="space-y-5">
      {/* Funnel Metrics */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)] mb-3 px-1">Funnel Overview (30 days)</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricBox label="Found" value={found30d} />
          <MetricBox label="Sent" value={sent30d} change={`${foundToSent}% conv`} />
          <MetricBox label="Replied" value={replied30d} change={`${sentToReply}% of sent`} />
          <MetricBox label="Booked" value={booked30d} change={`${replyToBooked}% of replies`} />
          <MetricBox label="Dismissed" value={dismissedCount} />
        </div>
      </section>

      {/* Conversion Funnel */}
      <section className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Conversion Funnel (7 days)</h3>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">Progress from lead discovery to booked meeting.</p>
        </div>
        <div className="px-5 py-5">
          <FunnelStep label="Found" value={found7d} width={100} color="bg-[var(--color-ink-3)]" />
          <FunnelStep label="Sent" value={sent7d} width={found7d > 0 ? Math.round((sent7d / found7d) * 100) : 0} color="bg-blue-400" />
          <FunnelStep label="Replied" value={replied7d} width={sent7d > 0 ? Math.round((replied7d / sent7d) * 100) : 0} color="bg-[var(--color-sig-expansion)]" />
          <FunnelStep label="Booked" value={booked7d} width={sent7d > 0 ? Math.round((booked7d / sent7d) * 100) : 0} color="bg-[var(--color-accent)]" />
        </div>
      </section>

      {/* Lifetime Metrics */}
      <section className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Lifetime Metrics</h3>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Total leads</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--color-text-1)]">{totalLeads}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Engaged</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--color-text-1)]">{engagedCount}</p>
            <p className="text-[11px] text-[var(--color-text-4)]">{totalLeads > 0 ? Math.round((engagedCount / totalLeads) * 100) : 0}% of total</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Booked (90 days)</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--color-text-1)]">{booked90d}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Reply rate</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--color-text-1)]">{sent30d > 0 ? Math.round((replied30d / sent30d) * 100) : 0}%</p>
            <p className="text-[11px] text-[var(--color-text-4)]">last 30 days</p>
          </div>
        </div>
      </section>

      {/* Top Insights */}
      {insights.length > 0 && (
        <section className="card overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Top Insights</h3>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">AI-generated recommendations impacting your revenue.</p>
          </div>
          <div className="divide-y divide-[var(--color-line-1)]">
            {insights.slice(0, 5).map((insight, i) => (
              <div key={i} className="px-5 py-3 hover:bg-[var(--color-ink-2)]/30 transition-colors">
                <div className="flex items-start gap-3">
                  <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent-ring)] shrink-0 mt-0.5">
                    {insight.insight_type?.replace(/_/g, ' ') ?? 'insight'}
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-[var(--color-text-1)]">{insight.title}</p>
                    <p className="text-[10px] text-[var(--color-text-4)] mt-0.5">Impact: {insight.impact_score}/10</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function MetricBox({ label, value, change }: { label: string; value: number; change?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase text-[var(--color-text-3)]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-text-1)]">{value}</p>
      {change && <p className="mt-0.5 text-[10px] text-[var(--color-text-4)]">{change}</p>}
    </div>
  )
}

function FunnelStep({ label, value, width, color }: { label: string; value: number; width: number; color: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-[var(--color-text-2)]">{label}</span>
        <span className="text-[11px] font-bold tabular-nums text-[var(--color-text-1)]">{value}</span>
      </div>
      <div className="w-full h-2.5 rounded-full bg-[var(--color-ink-2)] overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(width, 100)}%` }} />
      </div>
    </div>
  )
}

function inWindow(value: string | null | undefined, since: number): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= since
}
