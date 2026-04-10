'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import OutreachDrawer from './OutreachDrawer'

// ── Types ──────────────────────────────────────────────────────────

export interface SignalRow {
  signal_type: string
  headline: string
  summary: string | null
  funding_amount: string | null
  source_url: string | null
  published_at: string | null
}

export interface Lead {
  id: string
  target_company: string
  relevance_score: number
  relevance_reason: string | null
  status: string
  created_at: string
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
  signals: SignalRow | SignalRow[] | null
}

interface Props {
  initialLeads: Lead[]
  userId: string
  weeklyStats: { signals: number; drafted: number; sent: number; booked: number }
}

// ── Signal config ──────────────────────────────────────────────────

const SIGNAL_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  funding:     { label: 'Funding',     icon: '💰', color: 'text-blue-400',   bg: 'bg-blue-900/30' },
  acquisition: { label: 'Acquisition', icon: '🤝', color: 'text-orange-400', bg: 'bg-orange-900/30' },
  expansion:   { label: 'Expansion',   icon: '🌍', color: 'text-green-400',  bg: 'bg-green-900/30' },
  regulation:  { label: 'Regulation',  icon: '⚖️', color: 'text-purple-400', bg: 'bg-purple-900/30' },
  hiring:      { label: 'Hiring',      icon: '👥', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  new:      { label: 'New',      color: 'text-indigo-400', dot: 'bg-indigo-400' },
  viewed:   { label: 'Viewed',   color: 'text-gray-400',   dot: 'bg-gray-500' },
  drafted:  { label: 'Drafted',  color: 'text-blue-400',   dot: 'bg-blue-400' },
  sent:     { label: 'Sent',     color: 'text-green-400',  dot: 'bg-green-400' },
  replied:  { label: 'Replied',  color: 'text-emerald-400',dot: 'bg-emerald-400' },
  booked:   { label: 'Booked ✓', color: 'text-yellow-400', dot: 'bg-yellow-400' },
  dismissed:{ label: 'Dismissed',color: 'text-gray-600',   dot: 'bg-gray-700' },
}

function getSignal(lead: Lead): SignalRow | null {
  return Array.isArray(lead.signals) ? lead.signals[0] ?? null : lead.signals
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Main component ─────────────────────────────────────────────────

export default function LeadFeed({ initialLeads, userId, weeklyStats }: Props) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [activeLead, setActiveLead] = useState<Lead | null>(null)

  // Filters
  const [filterSignal, setFilterSignal] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('active')
  const [filterScore, setFilterScore] = useState<number>(0)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'created_at' | 'relevance_score'>('created_at')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  // ── Realtime subscription ──────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('leads-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'leads', filter: `user_id=eq.${userId}` },
        async payload => {
          const { data } = await supabase
            .from('leads')
            .select(`id, target_company, relevance_score, relevance_reason, status, created_at, sent_at, replied_at, booked_at,
              signals(signal_type, headline, summary, funding_amount, source_url, published_at)`)
            .eq('id', payload.new.id)
            .single()
          if (data) setLeads(prev => [data as unknown as Lead, ...prev])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  // ── Status helpers ─────────────────────────────────────────────
  async function updateStatus(leadId: string, status: string) {
    const res = await fetch(`/api/leads/${leadId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      const now = new Date().toISOString()
      setLeads(prev => prev.map(l => {
        if (l.id !== leadId) return l
        return {
          ...l,
          status,
          sent_at:    status === 'sent'    ? now : l.sent_at,
          replied_at: status === 'replied' ? now : l.replied_at,
          booked_at:  status === 'booked'  ? now : l.booked_at,
        }
      }))
    }
  }

  function openDraft(lead: Lead) {
    if (lead.status === 'new') updateStatus(lead.id, 'viewed')
    setActiveLead(lead)
  }

  // ── Filtered + sorted leads ────────────────────────────────────
  const filteredLeads = useMemo(() => {
    let result = leads

    if (filterSignal !== 'all') {
      result = result.filter(l => getSignal(l)?.signal_type === filterSignal)
    }
    if (filterStatus === 'active') {
      result = result.filter(l => l.status !== 'dismissed')
    } else if (filterStatus !== 'all') {
      result = result.filter(l => l.status === filterStatus)
    }
    if (filterScore > 0) {
      result = result.filter(l => l.relevance_score >= filterScore)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(l =>
        l.target_company.toLowerCase().includes(q) ||
        (l.relevance_reason || '').toLowerCase().includes(q)
      )
    }

    return [...result].sort((a, b) => {
      const valA = sortBy === 'relevance_score' ? a.relevance_score : new Date(a.created_at).getTime()
      const valB = sortBy === 'relevance_score' ? b.relevance_score : new Date(b.created_at).getTime()
      return sortDir === 'desc' ? valB - valA : valA - valB
    })
  }, [leads, filterSignal, filterStatus, filterScore, search, sortBy, sortDir])

  function toggleSort(field: 'created_at' | 'relevance_score') {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(field); setSortDir('desc') }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <>
      {/* Metrics bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Signals this week', value: weeklyStats.signals },
          { label: 'Emails drafted',    value: weeklyStats.drafted },
          { label: 'Sent',              value: weeklyStats.sent },
          { label: 'Calls booked',      value: weeklyStats.booked },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <div className="text-2xl font-bold text-white">{stat.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search companies…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Signal type */}
        <select
          value={filterSignal}
          onChange={e => setFilterSignal(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All signals</option>
          {Object.entries(SIGNAL_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.icon} {cfg.label}</option>
          ))}
        </select>

        {/* Status */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="active">Active leads</option>
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="drafted">Drafted</option>
          <option value="sent">Sent</option>
          <option value="replied">Replied</option>
          <option value="booked">Booked</option>
          <option value="dismissed">Dismissed</option>
        </select>

        {/* Score */}
        <select
          value={filterScore}
          onChange={e => setFilterScore(Number(e.target.value))}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value={0}>Any score</option>
          <option value={7}>7+ score</option>
          <option value={8}>8+ score</option>
          <option value={9}>9+ score</option>
        </select>

        <span className="text-xs text-gray-600 ml-auto">{filteredLeads.length} leads</span>
      </div>

      {/* Table */}
      {filteredLeads.length === 0 ? (
        <div className="text-center py-16 space-y-3 border border-gray-800 rounded-xl">
          <div className="text-3xl">📡</div>
          <p className="text-gray-400 text-sm">No leads match the current filters.</p>
          <p className="text-gray-600 text-xs">
            {leads.length === 0
              ? 'New leads will appear as signals are detected.'
              : 'Try adjusting the filters above.'}
          </p>
        </div>
      ) : (
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_140px_80px_120px_180px] gap-3 px-4 py-2.5 bg-gray-800/60 border-b border-gray-800 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <button className="text-left flex items-center gap-1 hover:text-gray-300 transition-colors"
              onClick={() => toggleSort('created_at')}>
              Company
              {sortBy === 'created_at' && <SortIcon dir={sortDir} />}
            </button>
            <span>Signal</span>
            <button className="text-left flex items-center gap-1 hover:text-gray-300 transition-colors"
              onClick={() => toggleSort('relevance_score')}>
              Score
              {sortBy === 'relevance_score' && <SortIcon dir={sortDir} />}
            </button>
            <span>Status</span>
            <span>Actions</span>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-gray-800/60">
            {filteredLeads.map(lead => (
              <LeadRow
                key={lead.id}
                lead={lead}
                onDraft={() => openDraft(lead)}
                onStatusChange={status => updateStatus(lead.id, status)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Outreach drawer */}
      {activeLead && (
        <OutreachDrawer
          lead={activeLead}
          onClose={() => setActiveLead(null)}
          onEmailSent={() => {
            updateStatus(activeLead.id, 'sent')
            setActiveLead(null)
          }}
          onDraftCreated={() => {
            if (activeLead.status === 'viewed' || activeLead.status === 'new') {
              updateStatus(activeLead.id, 'drafted')
            }
          }}
        />
      )}
    </>
  )
}

// ── Lead row ───────────────────────────────────────────────────────

function LeadRow({
  lead,
  onDraft,
  onStatusChange,
}: {
  lead: Lead
  onDraft: () => void
  onStatusChange: (status: string) => void
}) {
  const signal = getSignal(lead)
  const sigType = signal?.signal_type || 'funding'
  const sigCfg = SIGNAL_CONFIG[sigType] || SIGNAL_CONFIG.funding
  const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  return (
    <div className="grid grid-cols-[1fr_140px_80px_120px_180px] gap-3 px-4 py-3.5 hover:bg-gray-800/30 transition-colors group items-center">
      {/* Company + reason */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white truncate">{lead.target_company}</span>
          {lead.relevance_reason?.startsWith('[Watchlisted]') && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-400 shrink-0">★ Watchlisted</span>
          )}
        </div>
        {lead.relevance_reason && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {lead.relevance_reason.replace('[Watchlisted] ', '')}
          </p>
        )}
        <p className="text-xs text-gray-700 mt-0.5">{relativeTime(lead.created_at)}</p>
      </div>

      {/* Signal badge */}
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-medium px-2 py-1 rounded-full flex items-center gap-1 ${sigCfg.bg} ${sigCfg.color}`}>
          <span>{sigCfg.icon}</span>
          <span>{sigCfg.label}</span>
        </span>
      </div>

      {/* Score */}
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-white">{lead.relevance_score}<span className="text-gray-600 font-normal text-xs">/10</span></span>
        <div className="flex gap-0.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className={`w-1 h-1.5 rounded-sm ${i < lead.relevance_score ? 'bg-indigo-500' : 'bg-gray-700'}`} />
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="relative">
        <button
          onClick={() => setShowStatusMenu(s => !s)}
          className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusCfg.dot}`} />
          <span className={statusCfg.color}>{statusCfg.label}</span>
          <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showStatusMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowStatusMenu(false)} />
            <div className="absolute left-0 top-6 z-20 w-36 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 overflow-hidden">
              {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'dismissed').map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => { onStatusChange(key); setShowStatusMenu(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-gray-700 ${lead.status === key ? 'bg-gray-700/50' : ''}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  <span className={cfg.color}>{cfg.label}</span>
                </button>
              ))}
              <div className="border-t border-gray-700 mt-1 pt-1">
                <button
                  onClick={() => { onStatusChange('dismissed'); setShowStatusMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-gray-600 hover:text-gray-400 hover:bg-gray-700 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-700" />
                  Dismiss
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onDraft}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          {lead.status === 'new' || lead.status === 'viewed' ? 'Draft' : 'View draft'}
        </button>
        {signal?.source_url && (
          <a
            href={signal.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
            title="Read article"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  )
}

function SortIcon({ dir }: { dir: 'asc' | 'desc' }) {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d={dir === 'desc' ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'} />
    </svg>
  )
}
