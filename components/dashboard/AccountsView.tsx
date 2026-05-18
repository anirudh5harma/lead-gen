'use client'

import { useMemo, useState } from 'react'
import type { Lead } from '@/lib/leads'
import type { UserProfile } from './types'
import LeadDrawer from './LeadDrawer'
import Icon from '@/components/Icon'
import WatchlistManager from '@/components/WatchlistManager'

interface Props { profile: UserProfile; leads: Lead[]; commandSearch?: { query: string; nonce: number } | null }

type Filter = 'all' | 'hot' | 'sent' | 'replied' | 'booked'

/**
 * Signals — account pipeline as a single scannable list, Stitch editorial system.
 */
export default function AccountsView({ leads, commandSearch }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [signalType, setSignalType] = useState<string>('all')
  const [q, setQ] = useState(commandSearch?.query ?? '')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const signalTypes = useMemo(() => {
    const set = new Set<string>()
    for (const l of leads) { if (l.signal_type) set.add(l.signal_type) }
    return [...set].sort()
  }, [leads])

  const filtered = useMemo(() => {
    let xs = leads
    if (filter === 'hot') xs = xs.filter(l => (l.relevance_score ?? 0) >= 7)
    if (filter === 'sent') xs = xs.filter(l => l.sent_at && !l.replied_at)
    if (filter === 'replied') xs = xs.filter(l => l.replied_at && !l.booked_at)
    if (filter === 'booked') xs = xs.filter(l => l.booked_at || l.meeting_detected_at)
    if (signalType !== 'all') xs = xs.filter(l => l.signal_type === signalType)
    if (q.trim()) {
      const k = q.toLowerCase()
      xs = xs.filter(l => l.target_company.toLowerCase().includes(k))
    }
    return xs.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
  }, [leads, filter, signalType, q])

  const counts = useMemo(() => ({
    all: leads.length,
    hot: leads.filter(l => (l.relevance_score ?? 0) >= 7).length,
    sent: leads.filter(l => l.sent_at && !l.replied_at).length,
    replied: leads.filter(l => l.replied_at && !l.booked_at).length,
    booked: leads.filter(l => l.booked_at || l.meeting_detected_at).length,
  }), [leads])

  return (
    <div className="space-y-stack-lg font-body-main text-on-surface">
      <div>
        <p className="font-label-mono text-label-mono uppercase text-on-surface-variant mb-3">Pipeline</p>
        <h2 className="font-h1-editorial text-display-sm text-on-surface">
          Signals & <span className="italic text-primary">accounts</span>
        </h2>
      </div>

      <WatchlistManager />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {([['all', 'All'], ['hot', 'Hot fit'], ['sent', 'Sent'], ['replied', 'Replied'], ['booked', 'Booked']] as Array<[Filter, string]>).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`px-3 py-1 font-label-mono text-[10px] uppercase tracking-widest rounded-sm border transition-colors ${
              filter === id ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-high text-on-surface-variant border-transparent hover:border-primary'
            }`}
          >
            {label} <span className="opacity-60">{counts[id]}</span>
          </button>
        ))}
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 flex-wrap">
          {signalTypes.length > 0 && (
            <select
              value={signalType}
              onChange={(e) => setSignalType(e.target.value)}
              title="Filter by signal type"
              className="h-8 font-label-mono text-[10px] uppercase tracking-widest bg-surface-container-lowest hairline-border rounded-full px-3 text-on-surface-variant cursor-pointer outline-none max-w-full"
            >
              <option value="all">All signals</option>
              {signalTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2 hairline-border bg-surface-container-lowest rounded-full px-3 h-8 flex-1 sm:flex-none min-w-0">
            <Icon name="search" size={14} className="text-on-surface-variant shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search company…"
              className="bg-transparent border-none outline-none font-body-main text-on-surface placeholder:text-outline w-full sm:w-40 min-w-0"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface-container-lowest hairline-border rounded-lg p-12 text-center font-body-main text-on-surface-variant">No accounts match this filter yet.</div>
      ) : (
        <div className="bg-surface-container-lowest hairline-border rounded-lg overflow-hidden">
          <div className="bg-surface-container-low/30 px-6 py-3 hairline-b flex justify-between items-center">
            <span className="font-label-mono text-[10px] uppercase tracking-widest text-on-surface-variant">{filtered.length} accounts</span>
            <span className="font-label-mono text-[9px] uppercase text-on-surface-variant">Sorted by fit</span>
          </div>
          <div className="divide-y divide-[rgba(26,24,22,0.07)]">
            {filtered.slice(0, 200).map((l) => (
              <div key={l.id} className="px-4 sm:px-6 py-4 sm:py-5 hover:bg-surface-container-low transition-colors group sm:flex sm:items-center sm:gap-4">
                <div className="min-w-0 sm:flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-body-main font-medium text-on-surface">{l.target_company}</span>
                    <span className="font-label-mono text-tertiary text-sm sm:hidden ml-auto">{Math.round(l.relevance_score ?? 0)}</span>
                    {l.company_domain && <span className="font-label-mono text-[10px] text-outline">{l.company_domain}</span>}
                    {l.signal_type && <span className="font-label-mono text-[9px] uppercase tracking-widest text-on-surface-variant border border-outline-variant/40 rounded px-1 py-px">{l.signal_type.replace(/_/g, ' ')}</span>}
                  </div>
                  {l.relevance_reason && <p className="font-body-main text-on-surface-variant truncate mt-1 text-[13px] sm:text-base">{l.relevance_reason}</p>}
                </div>
                <div className="mt-3 sm:mt-0 flex items-center gap-2 flex-wrap sm:flex-nowrap sm:shrink-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {l.booked_at && <span className="font-label-mono text-[9px] uppercase tracking-widest bg-primary-container/10 text-primary px-1.5 py-0.5 rounded">Booked</span>}
                    {l.replied_at && !l.booked_at && <span className="font-label-mono text-[9px] uppercase tracking-widest bg-tertiary/10 text-tertiary px-1.5 py-0.5 rounded">Replied</span>}
                    {l.sent_at && !l.replied_at && <span className="font-label-mono text-[9px] uppercase tracking-widest bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded">Sent</span>}
                    {!l.sent_at && <span className="font-label-mono text-[9px] uppercase tracking-widest bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded">Queued</span>}
                  </div>
                  <span className="hidden sm:inline font-label-mono text-tertiary text-sm shrink-0 w-10 text-right">{Math.round(l.relevance_score ?? 0)}</span>
                  <button onClick={() => setSelectedLead(l)} className="ml-auto sm:ml-0 border border-outline text-on-surface font-label-mono text-[10px] uppercase tracking-[0.2em] px-4 py-2 hover:bg-surface-container transition-all shrink-0">Open</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />
    </div>
  )
}
