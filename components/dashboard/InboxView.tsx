'use client'

import { useState, useEffect } from 'react'

import type { Lead } from "@/lib/leads"
import type { GtmWorkItem, LaunchReadinessSnapshot, View } from './types'
import { TabLoadingState, StatusBadge, formatDateTime } from './shared'

interface Props {
  leads: Lead[]
  onNavigate: (view: View) => void
}

export default function InboxView({ leads, onNavigate }: Props) {
  const [workItems, setWorkItems] = useState<GtmWorkItem[]>([])
  const [workError, setWorkError] = useState<string | null>(null)
  const [workLoaded, setWorkLoaded] = useState(false)
  const [readiness, setReadiness] = useState<LaunchReadinessSnapshot | null>(null)
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [readinessLoaded, setReadinessLoaded] = useState(false)
  const [now] = useState(() => Date.now())

  const lastSevenDays = now - 7 * 24 * 60 * 60 * 1000
  const recentLeads = leads.filter(lead => new Date(lead.created_at).getTime() >= lastSevenDays)
  const approvals = leads
    .filter(lead => lead.status === 'drafted' || (lead.is_unlocked === true && Boolean(lead.contact_email) && !lead.sent_at))
    .sort(sortByLatestOutcome)

  useEffect(() => {
    let cancelled = false
    fetch('/api/gtm/readiness', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as (LaunchReadinessSnapshot & { error?: string }) | null
        if (cancelled) return
        if (!res.ok || !data) {
          setReadinessError(data?.error ?? 'Unable to load readiness.')
          setReadinessLoaded(true)
          return
        }
        setReadiness(data)
        setReadinessLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setReadinessError('Unable to load readiness.')
          setReadinessLoaded(true)
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/gtm/work-items?limit=30', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as { work_items?: GtmWorkItem[]; error?: string } | null
        if (cancelled) return
        if (!res.ok || !data) {
          setWorkError(data?.error ?? 'Unable to load work items.')
          setWorkLoaded(true)
          return
        }
        setWorkItems(data.work_items ?? [])
        setWorkLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setWorkError('Unable to load work items.')
          setWorkLoaded(true)
        }
      })
    return () => { cancelled = true }
  }, [])

  if (!workLoaded || !readinessLoaded) {
    return <TabLoadingState title="Loading Work" detail="Prioritizing account moves, replies, and safety checks." />
  }

  return (
    <div className="space-y-4">
      <StatusBanner readiness={readiness} error={readinessError} onNavigate={onNavigate} />

      <WorkInboxPanel items={workItems} error={workError} fallbackApprovals={approvals.slice(0, 4)} onNavigate={onNavigate} />

      <p className="text-[11px] text-[var(--color-text-4)]">
        {recentLeads.length} recent accounts monitored. Safety checks enforce verified contacts, unsubscribes, bounce suppression, caps, and pacing.
      </p>
    </div>
  )
}

function StatusBanner({ readiness, error, onNavigate }: { readiness: LaunchReadinessSnapshot | null; error: string | null; onNavigate: (view: View) => void }) {
  if (error) return (
    <div className="rounded-xl border border-[var(--color-line-2)] bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
      <span className="h-2 w-2 rounded-full bg-[var(--color-sig-regulation)]" />
      <p className="text-[12px] text-[var(--color-text-3)]">{error}</p>
    </div>
  )
  if (!readiness) return null

  const statusConfig = {
    blocked:   { label: 'Blocked',    cls: 'bg-red-50 text-red-600 border-red-100' },
    needs_work:{ label: 'Needs work', cls: 'bg-[#fff4df] text-[#936014] border-[#f0dcb0]' },
    ready:     { label: 'Ready',      cls: 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] border-[var(--color-accent-bg)]' },
    running:   { label: 'Running',    cls: 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] border-[var(--color-accent-bg)]' },
  }[readiness.status]

  const nextSegment = readiness.segments.find(segment => !segment.done)

  function act(segmentKey: string) {
    if (segmentKey === 'autopilot') onNavigate('autopilot')
    else if (segmentKey === 'inbox' || segmentKey === 'contacts' || segmentKey === 'credits') onNavigate('settings')
    else if (segmentKey === 'signals' || segmentKey === 'learning') onNavigate('accounts')
    else onNavigate('settings')
  }

  return (
    <div className="flex flex-wrap items-center gap-3 card px-4 py-3 shadow-sm">
      <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold border ${statusConfig.cls}`}>
        {statusConfig.label}
      </span>
      <span className="text-[12px] text-[var(--color-text-2)]">{readiness.headline}</span>
      {nextSegment && (
        <button onClick={() => act(nextSegment.key)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent-ring)] hover:text-[var(--color-accent)] transition-colors">
          {nextSegment.action}
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      )}
    </div>
  )
}

function WorkInboxPanel({ items, error, fallbackApprovals, onNavigate }: { items: GtmWorkItem[]; error: string | null; fallbackApprovals: Lead[]; onNavigate: (view: View) => void }) {
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [itemMessage, setItemMessage] = useState<string | null>(null)
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set())

  const visibleItems = items.length > 0
    ? items
    : fallbackApprovals.map(lead => ({
        id: `fallback:${lead.id}`,
        type: 'needs_approval' as const,
        status: 'open' as const,
        priority: lead.relevance_score ?? 0,
        title: `Review outreach for ${lead.target_company}`,
        body: lead.contact_email ? `${lead.contact_email} is ready for approve-first outreach.` : lead.relevance_reason ?? 'Ready for review.',
        account_name: lead.target_company,
        account_domain: lead.company_domain ?? null,
        lead_id: lead.id,
        account_id: null,
        workflow_run_id: null,
        policy_decision_id: null,
        action_label: 'Review',
        source: lead.origin ?? 'lead',
        created_at: lead.created_at,
        account_state_url: null,
      }))

  const displayItems = visibleItems.filter(item => !hiddenItemIds.has(item.id))

  async function updateLeadStatus(item: GtmWorkItem, status: 'viewed' | 'booked' | 'dismissed') {
    if (!item.lead_id) return
    setBusyItemId(item.id)
    setItemMessage(null)
    try {
      const res = await fetch(`/api/leads/${item.lead_id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setItemMessage(data?.error ?? 'Unable to update item.'); return }
      setItemMessage(status === 'dismissed' ? 'Item dismissed.' : status === 'booked' ? 'Marked booked.' : 'Marked viewed.')
      setHiddenItemIds(prev => new Set(prev).add(item.id))
    } catch { setItemMessage('Unable to update item.') }
    finally { setBusyItemId(null) }
  }

  return (
    <section className="card overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-5 py-4 bg-[var(--color-ink-2)]/30">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Next Moves</h3>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">The accounts Bombsell believes deserve attention now.</p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-4)] font-semibold">
          {displayItems.length} open
        </span>
      </div>
      {itemMessage && (
        <div className="border-b border-[var(--color-line-1)] px-5 py-2.5 text-[11px] text-[var(--color-accent-ring)] bg-[var(--color-accent-bg)]/40">
          {itemMessage}
        </div>
      )}
      {error ? (
        <div className="px-5 py-4 text-xs text-[var(--color-sig-regulation)]">{error}</div>
      ) : displayItems.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-[var(--color-ink-2)] mb-3">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} className="text-[var(--color-text-4)]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">No open work items</p>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">The next signal, reply, or blocked action will appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-line-1)]">
          {displayItems.slice(0, 10).map(item => (
            <WorkItemRow
              key={item.id}
              item={item}
              busy={busyItemId === item.id}
              onViewed={() => updateLeadStatus(item, 'viewed')}
              onBooked={() => updateLeadStatus(item, 'booked')}
              onDismissed={() => updateLeadStatus(item, 'dismissed')}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function WorkItemRow({
  item,
  busy,
  onViewed,
  onBooked,
  onDismissed,
  onNavigate,
}: {
  item: GtmWorkItem
  busy: boolean
  onViewed: () => void
  onBooked: () => void
  onDismissed: () => void
  onNavigate: (view: View) => void
}) {
  const typeIcon = getTypeIcon(item.type)
  const actionButtons = getActionButtons(item, busy, onViewed, onBooked, onDismissed, onNavigate)

  return (
    <div className="group px-5 py-4 hover:bg-[var(--color-ink-2)]/40 transition-colors duration-200">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        {/* Left: item info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={item.status} />
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-4)]">
              {typeIcon}
              {item.type.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] text-[var(--color-text-4)]">· {formatDateTime(item.created_at)}</span>
          </div>
          <p className="mt-2 text-[13px] font-semibold text-[var(--color-text-1)]">{item.title}</p>
          <p className="mt-1 text-[11.5px] leading-5 text-[var(--color-text-3)]">{item.body}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-[var(--color-text-4)]">
            <span className="inline-flex items-center gap-1">
              <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
              {item.account_name}
            </span>
            {item.account_domain && (
              <span className="inline-flex items-center gap-1">
                <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
                {item.account_domain}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              P{Math.round(item.priority)}
            </span>
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0 lg:pt-1">
          {actionButtons}
        </div>
      </div>
    </div>
  )
}

function getTypeIcon(type: string) {
  const icons: Record<string, React.ReactNode> = {
    needs_approval: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
    ),
    reply_detected: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
    ),
    blocked: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
    ),
  }
  return icons[type] ?? (
    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  )
}

function getActionButtons(
  item: GtmWorkItem,
  busy: boolean,
  onViewed: () => void,
  onBooked: () => void,
  onDismissed: () => void,
  onNavigate: (view: View) => void,
) {
  const buttons: React.ReactNode[] = []

  if (item.lead_id) {
    buttons.push(
      <button
        key="viewed"
        onClick={onViewed}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-1)] hover:bg-[var(--color-ink-2)] hover:border-[var(--color-line-3)] disabled:opacity-50 transition-all"
        title="Mark as reviewed"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        Reviewed
      </button>
    )
  }

  if (item.type === 'needs_approval') {
    buttons.push(
      <button
        key="approve"
        onClick={() => onNavigate('autopilot')}
        className="inline-flex items-center gap-1.5 rounded-lg btn-primary px-3 py-1.5 text-[11px] font-medium"
        title="Review sending mode"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Approve
      </button>
    )
  }

  if (item.lead_id && item.type === 'reply_detected') {
    buttons.push(
      <button
        key="booked"
        onClick={onBooked}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg btn-primary px-3 py-1.5 text-[11px] font-medium disabled:opacity-50"
        title="Mark as booked"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        Booked
      </button>
    )
  }

  if (item.lead_id) {
    buttons.push(
      <button
        key="dismiss"
        onClick={onDismissed}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--color-sig-regulation)] hover:bg-red-50 hover:border-red-100 disabled:opacity-50 transition-all"
        title="Dismiss item"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        Dismiss
      </button>
    )
  }

  return buttons
}

function sortByLatestOutcome(a: Lead, b: Lead) {
  return outcomeTime(b) - outcomeTime(a)
}

function outcomeTime(lead: Lead): number {
  return new Date(lead.booked_at ?? lead.replied_at ?? lead.sent_at ?? lead.created_at).getTime()
}
