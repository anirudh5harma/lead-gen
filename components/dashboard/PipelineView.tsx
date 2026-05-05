'use client'

import { useState, useEffect } from 'react'
import type { Lead } from '@/lib/leads'
import type { LaunchReadinessSnapshot } from './types'
import { TabLoadingState } from './shared'

interface Props {
  leads: Lead[]
}

export default function PipelineView({ leads }: Props) {
  const [readiness, setReadiness] = useState<LaunchReadinessSnapshot | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/gtm/readiness', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as (LaunchReadinessSnapshot & { error?: string }) | null
        if (cancelled) return
        if (data && res.ok) setReadiness(data)
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const [now] = useState(() => Date.now())
  const day = 24 * 60 * 60 * 1000
  const last30d = now - 30 * day

  const stageLeads = {
    observed: leads.filter(l => l.status === 'new' || l.status === 'viewed').length,
    qualified: leads.filter(l => l.status === 'drafted').length,
    engaged: leads.filter(l => l.status === 'sent').length,
    opportunity: leads.filter(l => l.status === 'replied').length,
    customer: leads.filter(l => l.status === 'booked').length,
    blocked: leads.filter(l => l.status === 'dismissed').length,
  }

  const totalPipeline = stageLeads.observed + stageLeads.qualified + stageLeads.engaged + stageLeads.opportunity

  const sent30d = leads.filter(l => inWindow(l.sent_at, last30d)).length
  const replied30d = leads.filter(l => inWindow(l.replied_at, last30d)).length
  const booked30d = leads.filter(l => inWindow(l.booked_at, last30d)).length

  const replyRate = sent30d > 0 ? Math.round((replied30d / sent30d) * 100) : 0
  const bookRate = sent30d > 0 ? Math.round((booked30d / sent30d) * 100) : 0

  const stages = [
    { key: 'observed', label: 'Observed', value: stageLeads.observed, color: 'bg-[var(--color-ink-3)]' },
    { key: 'qualified', label: 'Qualified', value: stageLeads.qualified, color: 'bg-blue-400' },
    { key: 'engaged', label: 'Engaged', value: stageLeads.engaged, color: 'bg-[var(--color-sig-expansion)]' },
    { key: 'opportunity', label: 'Opportunity', value: stageLeads.opportunity, color: 'bg-[var(--color-sig-funding)]' },
    { key: 'customer', label: 'Customer', value: stageLeads.customer, color: 'bg-[var(--color-accent)]' },
  ]

  const maxStageValue = Math.max(...stages.map(s => s.value), 1)

  if (!loaded) return <TabLoadingState title="Loading Pipeline" detail="Computing deal stages and revenue metrics." />

  return (
    <div className="space-y-5">
      {/* KPI Banner */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Total Pipeline" value={totalPipeline} subtitle="Active deals in funnel" />
        <MetricCard label="Reply Rate (30d)" value={`${replyRate}%`} subtitle={`${sent30d} sent → ${replied30d} replied`} />
        <MetricCard label="Book Rate (30d)" value={`${bookRate}%`} subtitle={`${booked30d} booked meetings`} />
        <MetricCard label="Revenue Ready" value={readiness?.status === 'running' ? 'Active' : readiness?.status === 'ready' ? 'Ready' : 'Setup'} subtitle={readiness?.headline ?? 'Configure GTM engine'} />
      </section>

      {/* Funnel Visualization */}
      <section className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Deal Pipeline</h3>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">Accounts by lifecycle stage. Revenue tracking coming in a future update.</p>
        </div>
        <div className="px-5 py-5 space-y-4">
          {stages.map(stage => (
            <div key={stage.key}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-semibold text-[var(--color-text-1)]">{stage.label}</span>
                <span className="text-[12px] font-bold tabular-nums text-[var(--color-text-2)]">{stage.value}</span>
              </div>
              <div className="w-full h-3 rounded-full bg-[var(--color-ink-2)] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${stage.color}`}
                  style={{ width: `${maxStageValue > 0 ? (stage.value / maxStageValue) * 100 : 0}%`, minWidth: stage.value > 0 ? '8px' : '0' }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Revenue forecast placeholder */}
      <section className="card overflow-hidden shadow-sm border border-dashed border-[var(--color-line-3)]">
        <div className="px-5 py-6 text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-[var(--color-ink-2)] mb-3">
            <svg className="w-6 h-6 text-[var(--color-text-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Revenue Forecast</h3>
          <p className="text-xs text-[var(--color-text-3)] mt-2 max-w-md mx-auto">
            Deal value tracking and weighted revenue forecasting will be available when the Pro tier launches.
            Pipeline stages automatically update as your leads move through the funnel.
          </p>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, subtitle }: { label: string; value: number | string; subtitle: string }) {
  return (
    <div className="card px-4 py-4 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-2 text-[26px] font-bold tracking-tight tabular-nums text-[var(--color-text-1)]">{value}</p>
      <p className="mt-1 text-[11px] text-[var(--color-text-4)]">{subtitle}</p>
    </div>
  )
}

function inWindow(value: string | null | undefined, since: number): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= since
}
