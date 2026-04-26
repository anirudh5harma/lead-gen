'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  normalizeLeadFeedSnapshot,
  type LeadFeedSnapshot,
  type LeadOrigin,
  type LeadSourceKind,
} from '@/lib/lead-sources'
import OutreachDrawer from './OutreachDrawer'
import LeadCard, { type SignalType, type LeadStatus, type LeadCardLead } from './LeadCard'
import SignalTimeline from './SignalTimeline'

export type SignalRow = LeadFeedSnapshot

export interface Lead {
  id: string
  client_id?: string | null
  origin?: LeadOrigin
  source_kind?: LeadSourceKind | null
  source_record_id?: string | null
  target_company: string
  company_domain?: string | null
  relevance_score: number
  relevance_reason: string | null
  status: string
  is_unlocked?: boolean
  unlocked_at?: string | null
  created_at: string
  sent_at?: string | null
  replied_at?: string | null
  booked_at?: string | null
  contact_email?: string | null
  contact_name?: string | null
  contact_title?: string | null
  feed_snapshot?: LeadFeedSnapshot | null
  signals?: SignalRow | SignalRow[] | null
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
  origin?: 'live' | 'explore' | 'crm_import'
  hideSignalTabs?: boolean
  searchPlaceholder?: string
  emptyTitle?: string
  emptyBody?: string
  exportFeed?: 'signal' | 'explore' | 'crm_import'
  onOpenCrmTab?: () => void
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
  const snapshot = normalizeLeadFeedSnapshot(lead.feed_snapshot)
  if (snapshot) return snapshot
  return Array.isArray(lead.signals) ? lead.signals[0] ?? null : lead.signals ?? null
}

function isSignalType(v: string): v is SignalType {
  return ['funding', 'acquisition', 'expansion', 'hiring', 'regulation', 'crm_import'].includes(v)
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
    is_unlocked: lead.is_unlocked !== false,
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

export default function LeadFeed({
  initialLeads,
  userId,
  watchlist = [],
  activeClientId = null,
  plan = 'free',
  origin = 'live',
  hideSignalTabs = false,
  searchPlaceholder = 'Search signals…',
  emptyTitle = 'No signals matched your ICP',
  emptyBody = 'Check back in an hour or refine your targeting in Settings.',
  exportFeed = origin === 'explore' ? 'explore' : origin === 'crm_import' ? 'crm_import' : 'signal',
  onOpenCrmTab,
}: Props) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [activeLead, setActiveLead] = useState<Lead | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [unlockingLeadId, setUnlockingLeadId] = useState<string | null>(null)
  const [timelineFor, setTimelineFor] = useState<{ name: string; domain?: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [filterSignal, setFilterSignal] = useState<'all' | SignalType>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'top_score'>('newest')
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState<'csv' | 'crm' | null>(null)

  const watchlistLookup = useMemo(() => {
    const s = new Set<string>()
    for (const w of watchlist) {
      s.add(w.company_name.toLowerCase())
      if (w.company_domain) s.add(w.company_domain.toLowerCase())
    }
    return s
  }, [watchlist])

  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

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
          const payloadOrigin = (payload.new as { origin?: Lead['origin'] | null }).origin ?? 'live'
          if (activeClientId !== payloadClientId) return
          if (payloadOrigin !== origin) return

          const { data } = await supabase
            .from('leads')
            .select(`id, client_id, origin, source_kind, source_record_id, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, unlocked_at, created_at, sent_at, replied_at, booked_at, contact_email, contact_name, contact_title, feed_snapshot`)
            .eq('id', payload.new.id)
            .single()
          if (data) {
            setLeads(prev => [data as unknown as Lead, ...prev])
            setToast(origin === 'explore' ? 'New explore result added' : origin === 'crm_import' ? 'New CRM prospect imported' : 'New signal detected')
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, activeClientId, origin])

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

  const unlockLead = useCallback(async (lead: Lead) => {
    if (lead.is_unlocked !== false) return true
    setUnlockingLeadId(lead.id)
    try {
      const res = await fetch(`/api/leads/${lead.id}/unlock`, { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { unlockedAt?: string; error?: string }
      if (!res.ok) {
        setToast(data.error || 'Unable to unlock this lead right now.')
        return false
      }
      setLeads(prev => prev.map(item =>
        item.id === lead.id
          ? { ...item, is_unlocked: true, unlocked_at: data.unlockedAt ?? new Date().toISOString() }
          : item
      ))
      return true
    } finally {
      setUnlockingLeadId(null)
    }
  }, [])

  const openDraft = useCallback(async (lead: Lead) => {
    if (lead.is_unlocked === false) {
      const unlocked = await unlockLead(lead)
      if (!unlocked) return
    }
    if (lead.status === 'new') updateStatus(lead.id, 'viewed')
    setActiveLead({ ...lead, is_unlocked: true, unlocked_at: lead.unlocked_at ?? new Date().toISOString() })
  }, [unlockLead, updateStatus])

  const filteredLeads = useMemo(() => {
    let result = leads.filter(l => (l.origin ?? 'live') === origin && l.status !== 'dismissed')
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
  }, [leads, filterSignal, search, sortBy, origin])

  const effectiveSelectedId = useMemo(() => {
    if (selectedId && filteredLeads.some(l => l.id === selectedId)) return selectedId
    return filteredLeads[0]?.id ?? null
  }, [filteredLeads, selectedId])

  const handleExport = useCallback(async (mode: 'csv' | 'crm') => {
    setExportOpen(false)

    const params = new URLSearchParams({ feed: exportFeed })

    if (mode === 'csv') {
      setExporting('csv')
      window.location.href = `/api/export/crm?${params.toString()}`
      setToast(exportFeed === 'explore' ? 'Explore CSV export started' : exportFeed === 'crm_import' ? 'CRM feed CSV export started' : 'Signal CSV export started')
      window.setTimeout(() => setExporting(null), 500)
      return
    }

    setExporting('crm')
    try {
      const settingsRes = await fetch('/api/settings/crm-sync', { cache: 'no-store' })
      const settings = await settingsRes.json().catch(() => null) as {
        enabled?: boolean
        webhook_url?: string
      } | null

      if (!settingsRes.ok || !settings?.enabled || !settings.webhook_url) {
        setToast('Connect CRM sync first to export directly into your CRM.')
        onOpenCrmTab?.()
        return
      }

      const res = await fetch(`/api/export/crm?${params.toString()}`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => null) as {
        ok?: boolean
        exported?: number
        error?: string
      } | null

      if (!res.ok || !data?.ok) {
        setToast(data?.error || 'CRM export failed')
        return
      }

      setToast(`Exported ${data.exported ?? 0} ${data.exported === 1 ? 'lead' : 'leads'} to CRM`)
    } catch {
      setToast('CRM export failed')
    } finally {
      setExporting(null)
    }
  }, [exportFeed, onOpenCrmTab])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        {hideSignalTabs ? (
          <div />
        ) : (
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
        )}

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setExportOpen(open => !open)}
              disabled={exporting !== null}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--color-line-2)] bg-white px-3.5 text-[12px] font-medium text-[var(--color-text-1)] transition-colors hover:bg-[var(--color-ink-2)] disabled:opacity-50"
            >
              <svg className="h-3.5 w-3.5 text-[var(--color-accent-ring)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16" />
              </svg>
              {exporting === 'csv' ? 'Exporting CSV…' : exporting === 'crm' ? 'Pushing to CRM…' : 'Export'}
              <svg className="h-3.5 w-3.5 text-[var(--color-text-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {exportOpen && (
              <div className="absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-2xl border border-[var(--color-line-1)] bg-white p-1.5 shadow-[0_20px_40px_-20px_#00000040,0_8px_16px_-8px_#00000024]">
                <button
                  onClick={() => handleExport('csv')}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-[var(--color-text-1)] transition-colors hover:bg-[var(--color-ink-2)]"
                >
                  <span>CSV</span>
                  <span className="text-[10px] text-[var(--color-text-4)]">Download</span>
                </button>
                <button
                  onClick={() => handleExport('crm')}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-[var(--color-text-1)] transition-colors hover:bg-[var(--color-ink-2)]"
                >
                  <span>CRM</span>
                  <span className="text-[10px] text-[var(--color-text-4)]">Push live</span>
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-3)] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder={searchPlaceholder}
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
        <div className="px-5 pb-5">
          <EmptyState title={emptyTitle} body={emptyBody} />
        </div>
      ) : (
        <div className="card mx-5 mb-5 overflow-x-auto">
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
                    actionBusy={unlockingLeadId === lead.id}
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="card flex flex-col items-center justify-center text-center py-20 px-4">
      <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent-bg)] flex items-center justify-center mb-4">
        <svg className="w-5 h-5 text-[var(--color-accent-ring)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <h3 className="text-[14px] font-medium text-[var(--color-text-1)]">{title}</h3>
      <p className="text-[12.5px] text-[var(--color-text-3)] mt-1.5 max-w-xs leading-relaxed">
        {body}
      </p>
    </div>
  )
}
