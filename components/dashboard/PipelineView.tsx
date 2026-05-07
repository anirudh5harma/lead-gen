'use client'

import { useState, useEffect } from 'react'
import type { Lead } from '@/lib/leads'
import type { LaunchReadinessSnapshot } from './types'
import { TabLoadingState, SectionHeader } from './shared'
import SpotlightCard from '@/components/landing/SpotlightCard'

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
    <div className="space-y-8">
      {/* KPI Banner */}
      <section>
        <SectionHeader
          title="Pipeline overview"
          subtitle="Deal flow and conversion metrics."
          label="Revenue"
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
          <MetricCard label="Total Pipeline" value={totalPipeline} subtitle="Active deals in funnel" />
          <MetricCard label="Reply Rate (30d)" value={`${replyRate}%`} subtitle={`${sent30d} sent → ${replied30d} replied`} />
          <MetricCard label="Book Rate (30d)" value={`${bookRate}%`} subtitle={`${booked30d} booked meetings`} />
          <MetricCard label="Revenue Ready" value={readiness?.status === 'running' ? 'Active' : readiness?.status === 'ready' ? 'Ready' : 'Setup'} subtitle={readiness?.headline ?? 'Configure GTM engine'} />
        </div>
      </section>

      {/* Funnel Visualization */}
      <section>
        <SectionHeader
          title="Deal stages"
          subtitle="Accounts by lifecycle stage. Revenue tracking coming in a future update."
          label="Funnel"
        />
        <SpotlightCard className="card overflow-hidden card-hover">
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
        </SpotlightCard>
      </section>
    </div>
  )
}

function MetricCard({ label, value, subtitle }: { label: string; value: number | string; subtitle: string }) {
  return (
    <SpotlightCard className="card px-4 py-4 card-hover">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-2 text-[26px] font-bold tracking-tight tabular-nums text-[var(--color-text-1)]">{value}</p>
      <p className="mt-1 text-[11px] text-[var(--color-text-4)]">{subtitle}</p>
    </SpotlightCard>
  )
}

function inWindow(value: string | null | undefined, since: number): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= since
}
