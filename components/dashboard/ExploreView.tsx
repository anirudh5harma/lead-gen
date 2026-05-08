'use client'

import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Lead } from '@/lib/leads'
import { StatusBadge, SectionHeader } from './shared'

interface Props {
  leads: Lead[]
}

interface ExploreSession {
  id: string
  prompt: string
  generated_count: number
  inserted_count: number
  created_at: string
  in_autopilot: boolean
  autopilot_status: string
}

type FilterKey = 'industry' | 'region' | 'revenue' | 'employee_count'
type ExtendedFilterKey = FilterKey | 'market_segment' | 'funding' | 'signal'

const INDUSTRIES = [
  'Any B2B industry',
  'SaaS and software',
  'AI and data infrastructure',
  'Fintech',
  'Healthcare technology',
  'Ecommerce and retail tech',
  'Cybersecurity',
  'Logistics and supply chain',
  'Manufacturing',
  'Professional services',
] as const

const REGIONS = [
  'Any region',
  'United States',
  'North America',
  'United Kingdom',
  'Europe',
  'India',
  'Asia Pacific',
  'Middle East',
  'Global English-speaking markets',
] as const

const REVENUE = [
  'Any revenue',
  'Under $1M',
  '$1M-$10M',
  '$10M-$50M',
  '$50M-$250M',
  '$250M+',
] as const

const EMPLOYEE_COUNTS = [
  'Any employee count',
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001-5000',
  '5000+',
] as const

const MARKET_SEGMENTS = [
  'Any market segment',
  'SMB',
  'Mid-Market',
  'Enterprise',
] as const

const FUNDING_OPTIONS = [
  'Any funding',
  'Funded in last 90 days',
  'Funded in last 180 days',
  'Latest round $1M-$10M',
  'Latest round $10M-$50M',
  'Latest round $50M+',
] as const

const SIGNAL_OPTIONS = [
  'Any signal',
  'Actively hiring',
  'High hiring volume',
  'Sales hiring',
  'Engineering hiring',
] as const

export default function ExploreView(_props: Props) {
  void _props

  const [filters, setFilters] = useState<Record<ExtendedFilterKey, string>>({
    industry: INDUSTRIES[0],
    region: REGIONS[0],
    revenue: REVENUE[0],
    employee_count: EMPLOYEE_COUNTS[0],
    market_segment: MARKET_SEGMENTS[0],
    funding: FUNDING_OPTIONS[0],
    signal: SIGNAL_OPTIONS[0],
  })
  const [count, setCount] = useState<5 | 10 | 20>(10)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showCreditConfirm, setShowCreditConfirm] = useState(false)
  const [actionBusy, setActionBusy] = useState<null | 'approve' | 'reject'>(null)

  const [sessions, setSessions] = useState<ExploreSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionBusy, setSessionBusy] = useState<string | null>(null)

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [sessionLeads, setSessionLeads] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])

  // Fetch sessions on mount
  useEffect(() => {
    let cancelled = false
    fetch('/api/explore/sessions', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ sessions?: ExploreSession[] }>)
      .then(data => {
        if (!cancelled) {
          const list = data.sessions ?? []
          setSessions(list)
          setSessionsLoading(false)
          // Auto-select the most recent session if none selected
          if (list.length > 0 && !selectedSessionId) {
            setSelectedSessionId(list[0].id)
          }
        }
      })
      .catch(() => { if (!cancelled) setSessionsLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch leads when selected session changes
  useEffect(() => {
    if (!selectedSessionId) {
      setSessionLeads([])
      setSelectedLeadIds([])
      return
    }
    let cancelled = false
    setLeadsLoading(true)
    setSelectedLeadIds([])
    fetch(`/api/explore/sessions/${selectedSessionId}/leads`, { cache: 'no-store' })
      .then(r => r.json() as Promise<{ leads?: Lead[]; error?: string }>)
      .then(data => {
        if (!cancelled) {
          setSessionLeads(data.leads ?? [])
          setLeadsLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setLeadsLoading(false) })
    return () => { cancelled = true }
  }, [selectedSessionId])

  const activeFilters = useMemo(() => ({
    industry: filters.industry.startsWith('Any') ? '' : filters.industry,
    region: filters.region.startsWith('Any') ? '' : filters.region,
    revenue: filters.revenue.startsWith('Any') ? '' : filters.revenue,
    employee_count: filters.employee_count.startsWith('Any') ? '' : filters.employee_count,
    market_segment: filters.market_segment.startsWith('Any') ? '' : filters.market_segment,
    funding: filters.funding.startsWith('Any') ? '' : filters.funding,
    signal: filters.signal.startsWith('Any') ? '' : filters.signal,
  }), [filters])

  const hasTargeting = Object.values(activeFilters).some(Boolean)

  const allSelectableIds = sessionLeads.map(lead => lead.id)
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedLeadIds.includes(id))

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null

  async function runSearch() {
    if (loading) return
    if (!hasTargeting) {
      setError('Select at least one filter before generating leads.')
      return
    }
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count,
          filters: activeFilters,
        }),
      })
      const payload = await response.json().catch(() => null) as {
        message?: string
        error?: string
        leads?: Lead[]
      } | null

      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'Lead search failed.')
      }

      const newLeads = payload?.leads ?? []
      const newSessionId = newLeads[0]?.feed_session_id ?? null

      // Refresh sessions and select the new one
      const sessionsRes = await fetch('/api/explore/sessions', { cache: 'no-store' })
      const sessionsData = await sessionsRes.json() as { sessions?: ExploreSession[] }
      const updatedSessions = sessionsData.sessions ?? []
      setSessions(updatedSessions)

      if (newSessionId) {
        setSelectedSessionId(newSessionId)
        setSessionLeads(newLeads)
        setSelectedLeadIds([])
      }
      setMessage(payload?.message ?? `Generated ${newLeads.length} leads.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lead search failed.')
    } finally {
      setLoading(false)
    }
  }

  function requestSearch() {
    if (loading) return
    if (!hasTargeting) {
      setError('Select at least one filter before generating leads.')
      return
    }
    setShowCreditConfirm(true)
  }

  function toggleSelectAll() {
    setSelectedLeadIds(current => current.length === allSelectableIds.length ? [] : [...allSelectableIds])
  }

  function toggleLeadSelection(leadId: string) {
    setSelectedLeadIds(current => (
      current.includes(leadId)
        ? current.filter(id => id !== leadId)
        : [...current, leadId]
    ))
  }

  async function runBulkAction(action: 'approve' | 'reject') {
    if (selectedLeadIds.length === 0 || actionBusy) return
    setActionBusy(action)
    setError(null)
    setMessage(null)
    try {
      if (action === 'approve') {
        // 1) Unlock leads
        const unlockSettled = await Promise.all(selectedLeadIds.map(async id => {
          const res = await fetch(`/api/leads/${id}/unlock`, { method: 'POST' })
          return res.ok
        }))
        const unlockedCount = unlockSettled.filter(Boolean).length

        // 2) Queue to CRM
        const queueRes = await fetch('/api/crm/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead_ids: selectedLeadIds }),
        })
        const queuePayload = await queueRes.json().catch(() => null) as { error?: string; queued?: number; skipped?: number } | null
        if (!queueRes.ok) throw new Error(queuePayload?.error ?? 'Failed to queue selected leads.')

        // Optimistically update UI
        setSessionLeads(prev => prev.map(lead => selectedLeadIds.includes(lead.id) ? { ...lead, is_unlocked: true } : lead))
        setMessage(`Approved ${unlockedCount} lead${unlockedCount === 1 ? '' : 's'} · queued ${queuePayload?.queued ?? 0} to workflow${queuePayload?.skipped ? ` (${queuePayload.skipped} skipped)` : ''}.`)
      } else {
        // Reject = dismiss
        const settled = await Promise.all(selectedLeadIds.map(async id => {
          const res = await fetch(`/api/leads/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'dismissed' }),
          })
          return res.ok
        }))
        const successCount = settled.filter(Boolean).length
        setSessionLeads(prev => prev.map(lead => selectedLeadIds.includes(lead.id) ? { ...lead, status: 'dismissed' } : lead))
        setMessage(`Rejected ${successCount} lead${successCount === 1 ? '' : 's'}${selectedLeadIds.length - successCount > 0 ? ` (${selectedLeadIds.length - successCount} failed)` : ''}.`)
      }
      setSelectedLeadIds([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk action failed.')
    } finally {
      setActionBusy(null)
    }
  }

  async function toggleSessionAutopilot(sessionId: string, action: 'add' | 'remove') {
    setSessionBusy(sessionId)
    try {
      const res = await fetch(`/api/explore/sessions/${sessionId}/autopilot`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean } | null
      if (data?.ok) {
        setSessions(prev => prev.map(s =>
          s.id === sessionId
            ? { ...s, in_autopilot: action === 'add', autopilot_status: action === 'add' ? 'queued' : 'paused' }
            : s
        ))
      }
    } finally {
      setSessionBusy(null)
    }
  }

  const filterCount = Object.values(activeFilters).filter(Boolean).length

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Find leads your way"
        subtitle="Tune filters and generate a focused account list for outreach."
        label="Explore"
      />

      {/* Concise Targeted Discovery */}
      <div className="card p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-bold text-[var(--color-text-1)] shrink-0">Targeted discovery</h2>
              {filterCount > 0 && (
                <span className="pill text-[10px] shrink-0">{filterCount} filter{filterCount === 1 ? '' : 's'}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={count}
                onChange={event => setCount(Number(event.target.value) as 5 | 10 | 20)}
                className="h-8 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[12px] text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent)]/10"
              >
                {[5, 10, 20].map(value => (
                  <option key={value} value={value}>{value} leads</option>
                ))}
              </select>
              <button
                onClick={requestSearch}
                disabled={!hasTargeting || loading}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg btn-primary px-3 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {loading ? 'Searching' : 'Generate'}
              </button>
            </div>
          </div>

          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
            <FilterSelect
              label="Industry"
              value={filters.industry}
              options={INDUSTRIES}
              onChange={value => setFilters(current => ({ ...current, industry: value }))}
            />
            <FilterSelect
              label="Region"
              value={filters.region}
              options={REGIONS}
              onChange={value => setFilters(current => ({ ...current, region: value }))}
            />
            <FilterSelect
              label="Revenue"
              value={filters.revenue}
              options={REVENUE}
              onChange={value => setFilters(current => ({ ...current, revenue: value }))}
            />
            <FilterSelect
              label="Employees"
              value={filters.employee_count}
              options={EMPLOYEE_COUNTS}
              onChange={value => setFilters(current => ({ ...current, employee_count: value }))}
            />
            <FilterSelect
              label="Segment"
              value={filters.market_segment}
              options={MARKET_SEGMENTS}
              onChange={value => setFilters(current => ({ ...current, market_segment: value }))}
            />
            <FilterSelect
              label="Funding"
              value={filters.funding}
              options={FUNDING_OPTIONS}
              onChange={value => setFilters(current => ({ ...current, funding: value }))}
            />
            <FilterSelect
              label="Signals"
              value={filters.signal}
              options={SIGNAL_OPTIONS}
              onChange={value => setFilters(current => ({ ...current, signal: value }))}
            />
          </div>
        </div>
      </div>

      {/* Alerts */}
      {(message || error) && (
        <div className={`rounded-lg border px-4 py-2.5 text-[12px] ${
          error
            ? 'border-[var(--color-pillar-quality-bg)] bg-[var(--color-pillar-quality-bg)]/30 text-[var(--color-pillar-quality)]'
            : 'border-[var(--color-line-1)] bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
        }`}>
          {error ?? message}
        </div>
      )}

      {/* Credit confirm modal — portal to body so it escapes transformed parents */}
      {showCreditConfirm && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--color-line-1)] bg-white p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Confirm Explore Search</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-text-3)]">
              Every lead generated will consume 1 credit from your Bombsell credits.
              This run is set to generate up to {count} leads.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowCreditConfirm(false)}
                className="h-8 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[11px] font-semibold text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowCreditConfirm(false)
                  void runSearch()
                }}
                className="h-8 rounded-lg btn-primary px-3 text-[11px] font-semibold"
              >
                Confirm and search
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Sessions Sidebar + Leads Main */}
      <div className="flex flex-col lg:flex-row gap-5">
        {/* Sidebar */}
        <aside className="shrink-0 lg:w-[240px]">
          <div className="card overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/50 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-3)]">Sessions</span>
              <span className="text-[10px] text-[var(--color-text-4)]">{sessions.length}</span>
            </div>
            <div className="max-h-[320px] lg:max-h-[520px] overflow-y-auto">
              {sessionsLoading ? (
                <div className="space-y-1 p-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--color-ink-2)]" />
                  ))}
                </div>
              ) : sessions.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-[11px] text-[var(--color-text-4)]">No sessions yet</p>
                </div>
              ) : (
                <div className="p-1.5 space-y-0.5">
                  {sessions.map(session => (
                    <button
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                      className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                        selectedSessionId === session.id
                          ? 'bg-[var(--color-accent-bg)] border border-[var(--color-accent-bg)]'
                          : 'hover:bg-[var(--color-ink-2)] border border-transparent'
                      }`}
                    >
                      <p className={`text-[11px] font-semibold line-clamp-2 leading-snug ${
                        selectedSessionId === session.id ? 'text-[var(--color-accent-ring)]' : 'text-[var(--color-text-1)]'
                      }`}>
                        {session.prompt}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] text-[var(--color-text-4)]">
                          {session.inserted_count} leads · {new Date(session.created_at).toLocaleDateString()}
                        </span>
                        {session.in_autopilot && (
                          <span className="inline-flex items-center rounded-full bg-[var(--color-accent-bg)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-accent-ring)]">
                            Auto
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main Leads Area */}
        <main className="flex-1 min-w-0">
          <div className="card overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/30 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {selectedSession && (
                  <>
                    <h3 className="text-[13px] font-bold text-[var(--color-text-1)] truncate">
                      {selectedSession.prompt}
                    </h3>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-4)]">
                      {selectedSession.inserted_count} leads
                    </span>
                  </>
                )}
                {!selectedSession && (
                  <h3 className="text-[13px] font-bold text-[var(--color-text-1)]">Select a session</h3>
                )}
              </div>
              <div className="shrink-0">
                {selectedSession && (
                  <button
                    onClick={() => toggleSessionAutopilot(selectedSession.id, selectedSession.in_autopilot ? 'remove' : 'add')}
                    disabled={sessionBusy === selectedSession.id}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                      selectedSession.in_autopilot
                        ? 'border border-[var(--color-line-2)] bg-white text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)]'
                        : 'btn-primary text-white'
                    }`}
                  >
                    {sessionBusy === selectedSession.id ? '…' : selectedSession.in_autopilot ? 'Remove Auto' : 'Add to Auto'}
                  </button>
                )}
              </div>
            </div>

            {/* Bulk toolbar */}
            {sessionLeads.length > 0 && (
              <div className="px-4 py-2 border-b border-[var(--color-line-1)] bg-white flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-[12px] text-[var(--color-text-2)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-[var(--color-line-2)] text-[var(--color-accent-ring)] focus:ring-[var(--color-accent)]/20"
                  />
                  Select all
                </label>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <span className="text-[11px] text-[var(--color-text-4)]">{selectedLeadIds.length} selected</span>
                  <button
                    onClick={() => runBulkAction('approve')}
                    disabled={selectedLeadIds.length === 0 || Boolean(actionBusy)}
                    className="h-7 rounded-lg btn-primary px-2.5 text-[11px] font-semibold disabled:opacity-50"
                  >
                    {actionBusy === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => runBulkAction('reject')}
                    disabled={selectedLeadIds.length === 0 || Boolean(actionBusy)}
                    className="h-7 rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] font-semibold text-[var(--color-text-2)] disabled:opacity-50 hover:bg-[var(--color-ink-2)]"
                  >
                    {actionBusy === 'reject' ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              </div>
            )}

            {/* Leads list */}
            <div className="divide-y divide-[var(--color-line-1)]">
              {leadsLoading ? (
                <div className="space-y-1 p-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded-lg bg-[var(--color-ink-2)]" />
                  ))}
                </div>
              ) : sessionLeads.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm font-semibold text-[var(--color-text-1)]">
                    {selectedSession ? 'No leads in this session' : 'Select a session to view leads'}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-4)]">
                    {selectedSession
                      ? 'This session generated no leads.'
                      : 'Choose a recent session from the sidebar or generate a new list.'}
                  </p>
                </div>
              ) : (
                sessionLeads.map(lead => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    selected={selectedLeadIds.includes(lead.id)}
                    onToggleSelection={() => toggleLeadSelection(lead.id)}
                  />
                ))
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-3)]">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-1 h-8 w-full rounded-lg border border-[var(--color-line-2)] bg-white px-2 text-[12px] text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent)]/10"
      >
        {options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function LeadRow({
  lead,
  selected,
  onToggleSelection,
}: {
  lead: Lead
  selected: boolean
  onToggleSelection: () => void
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--color-ink-2)]/40 transition-colors">
      <label className="inline-flex shrink-0 items-center pt-0.5 cursor-pointer">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelection}
          className="h-4 w-4 rounded border-[var(--color-line-2)] text-[var(--color-accent-ring)] focus:ring-[var(--color-accent)]/20"
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-[13px] font-bold text-[var(--color-text-1)] max-w-full">{lead.target_company}</h4>
          <span className="shrink-0 rounded-full bg-[var(--color-ink-2)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--color-text-2)]">
            {lead.relevance_score}/10
          </span>
          <StatusBadge status={lead.status} />
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-4)]">{lead.company_domain ?? 'Domain not confirmed'}</p>
        {lead.relevance_reason && (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-2)]">{lead.relevance_reason}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-4)]">
          <span className="rounded bg-[var(--color-ink-2)] px-1.5 py-0.5">Explore</span>
          {lead.is_unlocked && <span className="rounded bg-[var(--color-accent-bg)] px-1.5 py-0.5 text-[var(--color-accent-ring)]">Unlocked</span>}
          {lead.feed_session_label && <span className="max-w-full truncate rounded bg-[var(--color-ink-2)] px-1.5 py-0.5">{lead.feed_session_label}</span>}
        </div>
      </div>
    </div>
  )
}
