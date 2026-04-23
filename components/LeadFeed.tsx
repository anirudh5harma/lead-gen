'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import OutreachDrawer from './OutreachDrawer'
import LeadCard, { type SignalType, type LeadStatus, type LeadCardLead } from './LeadCard'
import SignalTimeline from './SignalTimeline'

export interface SignalRow {
  signal_type: string
  headline: string
  summary: string | null
  funding_amount: string | null
  source_url: string | null
  published_at: string | null
  company_domain?: string | null
}

export interface Lead {
  id: string
  client_id?: string | null
  target_company: string
  company_domain?: string | null
  relevance_score: number
  relevance_reason: string | null
  status: string
  created_at: string
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
  signals: SignalRow | SignalRow[] | null
}

interface WatchlistItem {
  id: string
  company_name: string
  company_domain: string | null
}

interface Props {
  initialLeads: Lead[]
  userId: string
  watchlist?: WatchlistItem[]
  activeClientId?: string | null
  plan?: 'free' | 'pro' | 'max'
}

const SIGNAL_TABS: { key: 'all' | SignalType; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'funding',     label: 'Funding' },
  { key: 'acquisition', label: 'Acquisition' },
  { key: 'expansion',   label: 'Expansion' },
  { key: 'hiring',      label: 'Hiring' },
  { key: 'regulation',  label: 'Regulation' },
]

function getSignal(lead: Lead): SignalRow | null {
  return Array.isArray(lead.signals) ? lead.signals[0] ?? null : lead.signals
}

function isSignalType(v: string): v is SignalType {
  return ['funding', 'acquisition', 'expansion', 'hiring', 'regulation'].includes(v)
}

function isLeadStatus(v: string): v is LeadStatus {
  return ['new', 'viewed', 'drafted', 'sent', 'replied', 'booked', 'dismissed'].includes(v)
}

function toCardLead(lead: Lead): LeadCardLead | null {
  const sig = getSignal(lead)
  if (!sig) return null
  const signalType: SignalType = isSignalType(sig.signal_type) ? sig.signal_type : 'funding'
  const status: LeadStatus = isLeadStatus(lead.status) ? lead.status : 'new'
  return {
    id: lead.id,
    target_company: lead.target_company,
    company_domain: lead.company_domain ?? sig.company_domain ?? undefined,
    relevance_score: lead.relevance_score,
    relevance_reason: lead.relevance_reason ?? '',
    status,
    created_at: lead.created_at,
    signals: {
      signal_type: signalType,
      headline: sig.headline,
      summary: sig.summary ?? '',
      published_at: sig.published_at ?? lead.created_at,
      company_domain: sig.company_domain ?? undefined,
    },
  }
}

export default function LeadFeed({ initialLeads, userId, watchlist = [], activeClientId = null, plan = 'free' }: Props) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [activeLead, setActiveLead] = useState<Lead | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timelineFor, setTimelineFor] = useState<{ name: string; domain?: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [filterSignal, setFilterSignal] = useState<'all' | SignalType>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'top_score'>('newest')

  const watchlistLookup = useMemo(() => {
    const s = new Set<string>()
    for (const w of watchlist) {
      s.add(w.company_name.toLowerCase())
      if (w.company_domain) s.add(w.company_domain.toLowerCase())
    }
    return s
  }, [watchlist])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('leads-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'leads',
          filter: `user_id=eq.${userId}`,
        },
        async payload => {
          const payloadClientId = (payload.new as { client_id?: string | null }).client_id ?? null
          if (activeClientId !== payloadClientId) return

          const { data } = await supabase
            .from('leads')
            .select(`id, client_id, target_company, relevance_score, relevance_reason, status, created_at, sent_at, replied_at, booked_at,
              signals(signal_type, headline, summary, funding_amount, source_url, published_at, company_domain)`)
            .eq('id', payload.new.id)
            .single()
          if (data) {
            setLeads(prev => [data as unknown as Lead, ...prev])
            setToast('✦ New signal detected')
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, activeClientId])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const updateStatus = useCallback(async (leadId: string, status: string) => {
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
          ...l, status,
          sent_at:    status === 'sent'    ? now : l.sent_at,
          replied_at: status === 'replied' ? now : l.replied_at,
          booked_at:  status === 'booked'  ? now : l.booked_at,
        }
      }))
    }
  }, [])

  const deleteLead = useCallback(async (leadId: string) => {
    const res = await fetch(`/api/leads/${leadId}`, { method: 'DELETE' })
    if (res.ok) {
      setLeads(prev => prev.filter(l => l.id !== leadId))
      setToast('Lead deleted')
    }
  }, [])

  const blockCompany = useCallback(async (
    leadId: string,
    companyName: string,
    companyDomain?: string
  ) => {
    const res = await fetch('/api/blocked-companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: companyName, company_domain: companyDomain ?? null }),
    })
    if (res.ok) {
      // Remove all leads from this company from the local state
      setLeads(prev => prev.filter(l => {
        const sameDomain = companyDomain && l.company_domain === companyDomain
        const sameName   = l.target_company.toLowerCase() === companyName.toLowerCase()
        return !sameDomain && !sameName
      }))
      setToast(`${companyName} blocked — no future leads`)
    }
  }, [])

  const openDraft = useCallback((lead: Lead) => {
    if (lead.status === 'new') updateStatus(lead.id, 'viewed')
    setActiveLead(lead)
  }, [updateStatus])

  const filteredLeads = useMemo(() => {
    let result = leads.filter(l => l.status !== 'dismissed')
    if (filterSignal !== 'all') result = result.filter(l => getSignal(l)?.signal_type === filterSignal)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(l =>
        l.target_company.toLowerCase().includes(q) ||
        (l.relevance_reason || '').toLowerCase().includes(q) ||
        (getSignal(l)?.headline || '').toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) =>
      sortBy === 'top_score'
        ? b.relevance_score - a.relevance_score
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }, [leads, filterSignal, search, sortBy])

  const effectiveSelectedId = useMemo(() => {
    if (selectedId && filteredLeads.some(l => l.id === selectedId)) return selectedId
    return filteredLeads[0]?.id ?? null
  }, [filteredLeads, selectedId])

  useEffect(() => {
    function isTyping(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false
      const t = el.tagName
      return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable
    }
    function handler(e: KeyboardEvent) {
      if (isTyping(e.target)) return
      if (e.key === 'Escape') { if (activeLead) { setActiveLead(null); e.preventDefault() }; return }
      if (!filteredLeads.length) return
      const idx = effectiveSelectedId ? filteredLeads.findIndex(l => l.id === effectiveSelectedId) : -1
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault(); setSelectedId(filteredLeads[Math.min(idx < 0 ? 0 : idx + 1, filteredLeads.length - 1)].id)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault(); setSelectedId(filteredLeads[Math.max(idx <= 0 ? 0 : idx - 1, 0)].id)
      } else if (e.key === 'd') {
        const sel = filteredLeads.find(l => l.id === effectiveSelectedId)
        if (sel) { e.preventDefault(); openDraft(sel) }
      } else if (e.key === 's' && effectiveSelectedId) {
        e.preventDefault(); updateStatus(effectiveSelectedId, 'sent')
      } else if (e.key === 'b' && effectiveSelectedId) {
        e.preventDefault(); updateStatus(effectiveSelectedId, 'booked')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filteredLeads, effectiveSelectedId, activeLead, openDraft, updateStatus])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-[var(--color-ink-2)] border border-[var(--color-line-1)]">
          {SIGNAL_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilterSignal(t.key)}
              className={`
                h-7 px-3 text-[12px] font-medium rounded-full transition-colors
                ${filterSignal === t.key
                  ? 'bg-white text-[var(--color-text-1)] shadow-[0_1px_0_#0000000a,0_1px_2px_#0000000f]'
                  : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)]'}
              `}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-3)] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search signals…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-[200px] pl-9 pr-3 h-9 rounded-full bg-white border border-[var(--color-line-2)] text-[12.5px] text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-colors"
            />
          </div>

          <div className="inline-flex h-9 p-1 rounded-full border border-[var(--color-line-2)] bg-white">
            {(['newest', 'top_score'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`
                  text-[11.5px] font-medium px-3 h-7 rounded-full transition-colors
                  ${sortBy === s ? 'bg-[var(--color-ink-2)] text-[var(--color-text-1)]' : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)]'}
                `}
              >
                {s === 'newest' ? 'Newest' : 'Top score'}
              </button>
            ))}
          </div>

          <span className="text-[11.5px] text-[var(--color-text-3)] tabular-nums ml-1">
            {filteredLeads.length} {filteredLeads.length === 1 ? 'lead' : 'leads'}
          </span>
        </div>
      </div>

      {/* Table */}
      {filteredLeads.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/60">
                {['#', 'Company', 'Signal', 'Score', 'Status', 'Time', ''].map((h, i) => (
                  <th
                    key={i}
                    className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-3)] text-left py-3 px-3 first:pl-5 last:pr-4 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead, i) => {
                const card = toCardLead(lead)
                if (!card) return null
                const domain = card.company_domain ?? lead.company_domain ?? undefined
                const watched =
                  watchlistLookup.has(lead.target_company.toLowerCase()) ||
                  (domain ? watchlistLookup.has(domain.toLowerCase()) : false)
                return (
                  <LeadCard
                    key={lead.id}
                    lead={card}
                    rowIndex={i + 1}
                    isSelected={effectiveSelectedId === lead.id}
                    onSelect={() => setSelectedId(lead.id)}
                    onDraftOutreach={() => openDraft(lead)}
                    onStatusChange={(id, status) => updateStatus(id, status)}
                    onOpenTimeline={(name, d) => setTimelineFor({ name, domain: d })}
                    onDelete={deleteLead}
                    onBlock={(id, name, domain) => blockCompany(id, name, domain)}
                    isWatchlisted={watched}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed top-6 right-6 z-50 flex items-center gap-3 pl-3 pr-4 py-2.5 rounded-xl bg-white border border-[var(--color-line-2)] border-l-4 border-l-[var(--color-accent)] shadow-[0_20px_40px_-16px_#0000001f,0_4px_12px_-6px_#00000014] toast-enter"
        >
          <span className="text-sm text-[var(--color-text-1)]">{toast}</span>
          <button onClick={() => setToast(null)} className="text-[var(--color-text-4)] hover:text-[var(--color-text-1)]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {timelineFor && (
        <SignalTimeline
          companyName={timelineFor.name}
          companyDomain={timelineFor.domain}
          onClose={() => setTimelineFor(null)}
        />
      )}

      {activeLead && (
        <OutreachDrawer
          lead={activeLead}
          plan={plan}
          onClose={() => setActiveLead(null)}
          onEmailSent={() => { updateStatus(activeLead.id, 'sent'); setActiveLead(null) }}
          onStatusChange={(status) => { updateStatus(activeLead.id, status); setActiveLead(null) }}
          onDraftCreated={() => {
            if (activeLead.status === 'viewed' || activeLead.status === 'new') {
              updateStatus(activeLead.id, 'drafted')
            }
          }}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="card flex flex-col items-center justify-center text-center py-20 px-4">
      <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent-bg)] flex items-center justify-center mb-4">
        <svg className="w-5 h-5 text-[var(--color-accent-ring)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <h3 className="text-[14px] font-medium text-[var(--color-text-1)]">No signals matched your ICP</h3>
      <p className="text-[12.5px] text-[var(--color-text-3)] mt-1.5 max-w-xs leading-relaxed">
        Check back in an hour or refine your targeting in Settings.
      </p>
    </div>
  )
}
