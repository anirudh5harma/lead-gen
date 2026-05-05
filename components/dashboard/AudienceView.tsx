'use client'

import { useMemo, useRef } from 'react'
import type { Lead } from '@/lib/leads'

interface Props {
  leads: Lead[]
}

export default function AudienceView({ leads }: Props) {
  // eslint-disable-next-line react-hooks/purity
  const last30d = useRef(Date.now()).current - 30 * 24 * 60 * 60 * 1000

  const analytics = useMemo(() => {
    const activeLeads = leads.filter(l => l.status !== 'dismissed')
    const bookedLeads = leads.filter(l => l.status === 'booked')
    const sentLeads = leads.filter(l => l.status === 'sent' || l.status === 'replied' || l.status === 'booked')
    const repliedLeads = leads.filter(l => l.status === 'replied' || l.status === 'booked')

    const recentSent = sentLeads.filter(l => inWindow(l.sent_at, last30d)).length
    const recentReplied = repliedLeads.filter(l => inWindow(l.replied_at, last30d)).length
    const recentBooked = bookedLeads.filter(l => inWindow(l.booked_at, last30d)).length

    const replyRate = recentSent > 0 ? Math.round((recentReplied / recentSent) * 100) : 0
    const bookRate = recentSent > 0 ? Math.round((recentBooked / recentSent) * 100) : 0

    // Domain analysis
    const domains = new Map<string, { count: number; sent: number; replied: number; booked: number }>()
    for (const lead of activeLeads) {
      const domain = lead.company_domain ?? 'unknown'
      if (!domains.has(domain)) domains.set(domain, { count: 0, sent: 0, replied: 0, booked: 0 })
      const d = domains.get(domain)!
      d.count++
      if (lead.status === 'sent' || lead.status === 'replied' || lead.status === 'booked') d.sent++
      if (lead.status === 'replied' || lead.status === 'booked') d.replied++
      if (lead.status === 'booked') d.booked++
    }
    const topDomains = Array.from(domains.entries())
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 8)

    // Content type / origin breakdown
    const originStats = new Map<string, { total: number; booked: number }>()
    for (const lead of activeLeads) {
      const origin = lead.origin ?? 'unknown'
      if (!originStats.has(origin)) originStats.set(origin, { total: 0, booked: 0 })
      const o = originStats.get(origin)!
      o.total++
      if (lead.status === 'booked') o.booked++
    }
    const originBreakdown = Array.from(originStats.entries())
      .sort(([, a], [, b]) => b.total - a.total)

    // Signal type analysis from feed_snapshot
    const signalTypeMap = new Map<string, { total: number; replied: number; booked: number }>()
    for (const lead of activeLeads) {
      const snapshot = lead.feed_snapshot as { signal_type?: string } | null
      const signalType = (snapshot?.signal_type as string) ?? 'general'
      if (!signalTypeMap.has(signalType)) signalTypeMap.set(signalType, { total: 0, replied: 0, booked: 0 })
      const s = signalTypeMap.get(signalType)!
      s.total++
      if (lead.status === 'replied' || lead.status === 'booked') s.replied++
      if (lead.status === 'booked') s.booked++
    }
    const signalTypes = Array.from(signalTypeMap.entries())
      .sort(([, a], [, b]) => b.total - a.total)

    return {
      totalLeads: activeLeads.length,
      bookedLeads: bookedLeads.length,
      replyRate,
      bookRate,
      recentBooked,
      topDomains,
      originBreakdown,
      signalTypes,
    }
  }, [leads, last30d])

  return (
    <div className="space-y-5">
      {/* KPI Row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Active Leads" value={analytics.totalLeads} />
        <KPI label="Booked (30d)" value={analytics.recentBooked} />
        <KPI label="Reply Rate" value={`${analytics.replyRate}%`} />
        <KPI label="Book Rate" value={`${analytics.bookRate}%`} />
      </section>

      {/* Origin Breakdown */}
      <section className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Lead Mix by Source</h3>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">How leads flow in from different channels and how they convert.</p>
        </div>
        <div className="divide-y divide-[var(--color-line-1)]">
          {analytics.originBreakdown.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-[var(--color-text-3)]">
              No lead data yet. Leads will populate as signals are matched and explored.
            </div>
          ) : (
            <>
              <div className="px-5 py-2 flex items-center gap-4 text-[10px] font-semibold uppercase text-[var(--color-text-4)]">
                <span className="flex-1">Source</span>
                <span className="w-16 text-right">Leads</span>
                <span className="w-16 text-right">Booked</span>
                <span className="w-16 text-right">Conv.</span>
              </div>
              {analytics.originBreakdown.map(([origin, stats]) => (
                <div key={origin} className="px-5 py-3 flex items-center gap-4 hover:bg-[var(--color-ink-2)]/30 transition-colors">
                  <span className="flex-1 text-xs font-semibold text-[var(--color-text-1)] capitalize">{origin.replace(/_/g, ' ')}</span>
                  <span className="w-16 text-right text-xs tabular-nums text-[var(--color-text-2)]">{stats.total}</span>
                  <span className="w-16 text-right text-xs tabular-nums text-[var(--color-accent-ring)] font-semibold">{stats.booked}</span>
                  <span className="w-16 text-right text-xs tabular-nums text-[var(--color-text-3)]">
                    {stats.total > 0 ? Math.round((stats.booked / stats.total) * 100) : 0}%
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* Signal Type Performance */}
      <section className="card overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Signal Type Performance</h3>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">Which buying signals drive the best outcomes for your ICP.</p>
        </div>
        <div className="divide-y divide-[var(--color-line-1)]">
          {analytics.signalTypes.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-[var(--color-text-3)]">
              Waiting for signal data. Signal types appear as leads are matched and engaged.
            </div>
          ) : (
            <>
              <div className="px-5 py-2 flex items-center gap-4 text-[10px] font-semibold uppercase text-[var(--color-text-4)]">
                <span className="flex-1">Signal Type</span>
                <span className="w-16 text-right">Leads</span>
                <span className="w-16 text-right">Replied</span>
                <span className="w-16 text-right">Booked</span>
                <span className="w-16 text-right">Rate</span>
              </div>
              {analytics.signalTypes.map(([signal, stats]) => (
                <div key={signal} className="px-5 py-3 flex items-center gap-4 hover:bg-[var(--color-ink-2)]/30 transition-colors">
                  <span className="flex-1 text-xs font-semibold text-[var(--color-text-1)] capitalize">{signal.replace(/_/g, ' ')}</span>
                  <span className="w-16 text-right text-xs tabular-nums text-[var(--color-text-2)]">{stats.total}</span>
                  <span className="w-16 text-right text-xs tabular-nums text-[var(--color-text-2)]">{stats.replied}</span>
                  <span className="w-16 text-right text-xs tabular-nums text-[var(--color-accent-ring)] font-semibold">{stats.booked}</span>
                  <span className="w-16 text-right text-xs tabular-nums text-[var(--color-text-3)]">
                    {stats.total > 0 ? Math.round((stats.booked / stats.total) * 100) : 0}%
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* Top Domains */}
      {analytics.topDomains.length > 0 && (
        <section className="card overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30">
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Top Domains</h3>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">Most active company domains by lead volume and engagement.</p>
          </div>
          <div className="divide-y divide-[var(--color-line-1)]">
            {analytics.topDomains.map(([domain, stats]) => (
              <div key={domain} className="px-5 py-3 flex items-center gap-4 hover:bg-[var(--color-ink-2)]/30 transition-colors">
                <span className="flex-1 text-xs font-semibold text-[var(--color-text-1)]">{domain}</span>
                <span className="text-xs tabular-nums text-[var(--color-text-2)]">{stats.count} leads</span>
                <span className="text-xs tabular-nums text-[var(--color-text-3)]">{stats.sent} sent</span>
                <span className="text-xs tabular-nums text-[var(--color-text-3)]">{stats.replied} replies</span>
                <span className="text-xs tabular-nums text-[var(--color-accent-ring)] font-semibold">{stats.booked} booked</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function KPI({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase text-[var(--color-text-3)]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-text-1)]">{value}</p>
    </div>
  )
}

function inWindow(value: string | null | undefined, since: number): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= since
}
