'use client'

import { useMemo, useState, useEffect } from 'react'
import type { Lead } from '@/lib/leads'
import { StatusBadge, SectionHeader } from './shared'
import SpotlightCard from '@/components/landing/SpotlightCard'

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

export default function ExploreView(_props: Props) {
  void _props

  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    industry: INDUSTRIES[0],
    region: REGIONS[0],
    revenue: REVENUE[0],
    employee_count: EMPLOYEE_COUNTS[0],
  })
  const [count, setCount] = useState(12)
  const [notes, setNotes] = useState('')
  const [results, setResults] = useState<Lead[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [sessions, setSessions] = useState<ExploreSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionBusy, setSessionBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/explore/sessions', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ sessions?: ExploreSession[] }>)
      .then(data => { if (!cancelled) { setSessions(data.sessions ?? []); setSessionsLoading(false) } })
      .catch(() => { if (!cancelled) setSessionsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const activeFilters = useMemo(() => ({
    industry: filters.industry.startsWith('Any') ? '' : filters.industry,
    region: filters.region.startsWith('Any') ? '' : filters.region,
    revenue: filters.revenue.startsWith('Any') ? '' : filters.revenue,
    employee_count: filters.employee_count.startsWith('Any') ? '' : filters.employee_count,
  }), [filters])

  const hasTargeting = Object.values(activeFilters).some(Boolean) || notes.trim().length > 0

  async function runSearch() {
    if (!hasTargeting || loading) return
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: notes.trim(),
          count,
          filters: activeFilters,
          icp_hint: 'Use the workspace ICP as the primary fit filter.',
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

      setResults(payload?.leads ?? [])
      setMessage(payload?.message ?? 'Lead search completed.')
      // Refresh sessions after generation
      const sessionsRes = await fetch('/api/explore/sessions', { cache: 'no-store' })
      const sessionsData = await sessionsRes.json() as { sessions?: ExploreSession[] }
      setSessions(sessionsData.sessions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lead search failed.')
      setResults([])
    } finally {
      setLoading(false)
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

  return (
    <div className="space-y-8">
      {/* Search */}
      <section>
        <SectionHeader
          title="Find leads your way"
          subtitle="Select broad filters, let Bombsell apply your ICP, and generate a fresh account list for sales outreach."
          label="Explore"
        />
        <SpotlightCard className="card overflow-hidden card-hover">
          <div className="border-b border-[var(--color-line-1)] bg-[linear-gradient(135deg,#f7f3ea_0%,#eef7f2_46%,#f8fbff_100%)] px-5 py-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="mt-1 text-lg font-bold text-[var(--color-text-1)]">Targeted discovery</h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--color-text-3)]">
                  Generated leads are saved into Explore and can be unlocked or exported from your normal sales workflow.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-2)] shadow-sm">
                <span className="h-2 w-2 rounded-full bg-[var(--color-accent-ring)]" />
                ICP-aware search
              </div>
            </div>
          </div>

          <div className="px-5 py-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                label="Employee count"
                value={filters.employee_count}
                options={EMPLOYEE_COUNTS}
                onChange={value => setFilters(current => ({ ...current, employee_count: value }))}
              />
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px]">
              <label className="block">
                <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Targeting notes</span>
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  rows={3}
                  placeholder="Optional: focus on teams likely hiring sales ops, expanding outbound, changing CRM, entering a new market..."
                  className="mt-1 w-full resize-none rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-2 text-[13px] leading-relaxed text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent)]/10"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[var(--color-text-2)]">Results</span>
                <select
                  value={count}
                  onChange={event => setCount(Number(event.target.value))}
                  className="mt-1 h-[38px] w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[13px] text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent)]/10"
                >
                  {[8, 12, 20, 30, 50].map(value => (
                    <option key={value} value={value}>{value} leads</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-[var(--color-text-4)]">
                Generated leads are saved into Explore and can be unlocked or exported from your normal sales workflow.
              </p>
              <button
                onClick={runSearch}
                disabled={!hasTargeting || loading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg btn-primary px-4 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {loading ? 'Searching' : 'Generate leads'}
              </button>
            </div>
          </div>
        </SpotlightCard>
      </section>

      {(message || error) && (
        <div className={`rounded-lg border px-4 py-3 text-[12px] ${
          error
            ? 'border-[var(--color-pillar-quality-bg)] bg-[var(--color-pillar-quality-bg)]/30 text-[var(--color-pillar-quality)]'
            : 'border-[var(--color-line-1)] bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
        }`}>
          {error ?? message}
        </div>
      )}

      {/* Recent Sessions */}
      <section>
        <SectionHeader
          title="Recent sessions"
          subtitle="Previously generated account lists. Add sessions to autopilot for automated outreach."
          label="History"
        />
        {sessionsLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-[var(--color-line-1)] bg-white" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="card px-5 py-10 text-center">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">No sessions yet</p>
            <p className="mt-1 text-xs text-[var(--color-text-4)]">Generate your first targeted list to see it here.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 stagger-children">
            {sessions.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                busy={sessionBusy === session.id}
                onToggle={() => toggleSessionAutopilot(session.id, session.in_autopilot ? 'remove' : 'add')}
              />
            ))}
          </div>
        )}
      </section>

      {/* Generated Results */}
      <section>
        <SectionHeader
          title="Generated leads"
          subtitle={results.length > 0 ? `${results.length} leads from the latest search` : 'Run a search to generate leads'}
        />
        {results.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-line-2)] bg-white px-5 py-10 text-center">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">No generated list yet</p>
            <p className="mt-1 text-xs text-[var(--color-text-4)]">Pick filters and run a custom search to create a targeted account list.</p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 stagger-children">
            {results.map(lead => (
              <LeadResultCard key={lead.id} lead={lead} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SessionCard({ session, busy, onToggle }: { session: ExploreSession; busy: boolean; onToggle: () => void }) {
  return (
    <SpotlightCard className="card p-4 card-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[var(--color-text-1)] line-clamp-2">{session.prompt}</p>
          <p className="mt-1 text-[11px] text-[var(--color-text-4)]">
            {session.inserted_count} of {session.generated_count} leads · {new Date(session.created_at).toLocaleDateString()}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              session.autopilot_status === 'queued' ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' :
              session.autopilot_status === 'sending' ? 'bg-green-50 text-green-600' :
              session.autopilot_status === 'completed' ? 'bg-[var(--color-ink-3)] text-[var(--color-text-4)]' :
              'bg-[var(--color-ink-2)] text-[var(--color-text-3)]'
            }`}>
              {session.autopilot_status}
            </span>
            {session.in_autopilot && (
              <span className="text-[10px] text-[var(--color-accent-ring)] font-medium">In autopilot</span>
            )}
          </div>
        </div>
        <button
          onClick={onToggle}
          disabled={busy}
          className={`shrink-0 h-8 px-3 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 ${
            session.in_autopilot
              ? 'border border-[var(--color-line-1)] bg-white text-[var(--color-text-2)] hover:text-[var(--color-sig-regulation)]'
              : 'btn-primary text-white'
          }`}
        >
          {busy ? '…' : session.in_autopilot ? 'Remove' : 'Add to Autopilot'}
        </button>
      </div>
    </SpotlightCard>
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
      <span className="text-[11px] font-semibold text-[var(--color-text-2)]">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-1 h-[38px] w-full rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[13px] text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent)]/10"
      >
        {options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function LeadResultCard({ lead }: { lead: Lead }) {
  return (
    <article className="rounded-lg border border-[var(--color-line-1)] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]/30 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-[var(--color-text-1)]">{lead.target_company}</h4>
          <p className="mt-1 truncate text-[12px] text-[var(--color-text-4)]">{lead.company_domain ?? 'Domain not confirmed'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={lead.status} />
          <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--color-text-2)]">
            {lead.relevance_score}/10
          </span>
        </div>
      </div>
      {lead.relevance_reason && (
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-text-2)]">{lead.relevance_reason}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-4)]">
        <span className="rounded bg-[var(--color-ink-2)] px-2 py-1">Explore</span>
        {lead.feed_session_label && <span className="max-w-full truncate rounded bg-[var(--color-ink-2)] px-2 py-1">{lead.feed_session_label}</span>}
      </div>
    </article>
  )
}
