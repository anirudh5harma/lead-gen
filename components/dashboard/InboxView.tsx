'use client'

import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { Lead } from "@/lib/leads"
import type { GtmWorkItem, LaunchReadinessSnapshot, View } from './types'
import { TabLoadingState, formatDateTime } from './shared'

interface Props {
  leads: Lead[]
  onNavigate: (view: View) => void
}

type WorkQueueView = 'priority' | 'all' | 'approvals' | 'replies' | 'blocked' | 'opportunities' | 'followups'

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
    .filter(lead => lead.status === 'drafted' || (lead.status !== 'viewed' && lead.is_unlocked === true && Boolean(lead.contact_email) && !lead.sent_at))
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
    fetch('/api/gtm/work-items?limit=100', { cache: 'no-store' })
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
    <div className="space-y-6">
      <StatusBanner readiness={readiness} error={readinessError} onNavigate={onNavigate} />

      <WorkInboxPanel items={workItems} error={workError} fallbackApprovals={approvals.slice(0, 4)} />

      <p className="text-[11px] text-[var(--color-text-4)]">
        {recentLeads.length} recent accounts monitored. Safety checks enforce verified contacts, unsubscribes, bounce suppression, caps, and pacing.
      </p>
    </div>
  )
}

function outcomeTime(lead: Lead): number {
  return new Date(lead.booked_at ?? lead.replied_at ?? lead.sent_at ?? lead.created_at).getTime()
}

function StatusBanner({ readiness, error, onNavigate }: { readiness: LaunchReadinessSnapshot | null; error: string | null; onNavigate: (view: View) => void }) {
  if (error) return (
    <div className="card px-4 py-3 flex items-center gap-3">
      <span className="h-2 w-2 rounded-full bg-[var(--color-sig-regulation)]" />
      <p className="text-[12px] text-[var(--color-text-3)]">{error}</p>
    </div>
  )
  if (!readiness) return null

  const statusConfig = {
    blocked:   { label: 'Blocked',    cls: 'bg-[var(--color-pillar-quality-bg)] text-[var(--color-pillar-quality)] border-[var(--color-pillar-quality-bg)]' },
    needs_work:{ label: 'Needs work', cls: 'bg-[var(--color-pillar-timing-bg)] text-[var(--color-pillar-timing)] border-[var(--color-pillar-timing-bg)]' },
    ready:     { label: 'Ready',      cls: 'bg-[var(--color-pillar-accuracy-bg)] text-[var(--color-pillar-accuracy)] border-[var(--color-pillar-accuracy-bg)]' },
    running:   { label: 'Running',    cls: 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] border-[var(--color-accent-bg)]' },
  }[readiness.status]

  const nextSegment = readiness.segments.find(segment => !segment.done)

  function act(segmentKey: string) {
    if (segmentKey === 'autopilot') onNavigate('engine/autopilot')
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

function WorkInboxPanel({ items, error, fallbackApprovals }: { items: GtmWorkItem[]; error: string | null; fallbackApprovals: Lead[] }) {
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: number; tone: 'success' | 'error'; message: string } | null>(null)
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set())
  const [queueView, setQueueView] = useState<WorkQueueView>('priority')
  const [visibleLimit, setVisibleLimit] = useState(20)
  const [draftDrawer, setDraftDrawer] = useState<{ item: GtmWorkItem; draft: OutreachDraftPreview | null; loading: boolean; error: string | null } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(current => current?.id === toast.id ? null : current), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const visibleItems = items.length > 0
    ? items
    : fallbackApprovals.map(lead => ({
        id: `lead:${lead.id}:needs_approval`,
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
  const listIsCapped = visibleItems.length >= 100
  const priorityItems = displayItems.filter(isPriorityWorkItem).slice(0, 12)
  const queueItems = filterWorkItems(displayItems, queueView, priorityItems)
  const visibleQueueItems = queueView === 'priority' ? queueItems : queueItems.slice(0, visibleLimit)
  const hasMoreItems = visibleQueueItems.length < queueItems.length
  const filterOptions: Array<{ id: WorkQueueView; label: string; count: number }> = [
    { id: 'priority', label: 'Priority', count: priorityItems.length },
    { id: 'approvals', label: 'Approvals', count: displayItems.filter(item => item.type === 'needs_approval').length },
    { id: 'replies', label: 'Replies', count: displayItems.filter(item => item.type === 'reply_detected').length },
    { id: 'blocked', label: 'Blocked', count: displayItems.filter(item => item.status === 'blocked' || item.type === 'policy_blocked' || item.type === 'workflow_failed').length },
    { id: 'opportunities', label: 'Opportunities', count: displayItems.filter(item => item.type === 'new_opportunity').length },
    { id: 'followups', label: 'Follow-ups', count: displayItems.filter(item => item.type === 'sent_followup_pending').length },
    { id: 'all', label: 'All', count: displayItems.length },
  ]
  const reminderItems = displayItems.filter(item => item.type === 'sent_followup_pending' && item.lead_id)

  async function updateWorkItem(item: GtmWorkItem, action: 'reviewed' | 'approved' | 'discussed' | 'dismissed' | 'booked') {
    if (!item.lead_id) return
    setBusyItemId(item.id)
    setHiddenItemIds(prev => new Set(prev).add(item.id))
    try {
      const res = await fetch('/api/gtm/work-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, action, lead_id: item.lead_id, metadata: { type: item.type } }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        setHiddenItemIds(prev => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
        showToast('error', data?.error ?? 'Unable to update item.')
        return
      }
      const messages = {
        reviewed: 'Item reviewed.',
        approved: 'Item approved.',
        discussed: 'Item moved to discussion.',
        dismissed: 'Item dismissed.',
        booked: 'Marked booked.',
      }
      showToast('success', messages[action])
    } catch {
      setHiddenItemIds(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      showToast('error', 'Unable to update item.')
    }
    finally { setBusyItemId(null) }
  }

  async function openDraftDrawer(item: GtmWorkItem) {
    if (!item.lead_id || busyItemId) return
    setBusyItemId(item.id)
    setDraftDrawer({ item, draft: null, loading: true, error: null })
    try {
      const res = await fetch(`/api/leads/${item.lead_id}/draft`, { method: 'POST', cache: 'no-store' })
      const data = await res.json().catch(() => null) as { draft?: OutreachDraftPreview; error?: string } | null
      if (!res.ok || !data?.draft) {
        setDraftDrawer({ item, draft: null, loading: false, error: data?.error ?? 'Unable to prepare draft.' })
        return
      }
      setDraftDrawer({ item, draft: data.draft, loading: false, error: null })
    } catch {
      setDraftDrawer({ item, draft: null, loading: false, error: 'Unable to prepare draft.' })
    } finally {
      setBusyItemId(null)
    }
  }

  async function approveFromDrawer() {
    if (!draftDrawer) return
    const item = draftDrawer.item
    setDraftDrawer(null)
    await updateWorkItem(item, 'approved')
  }

  async function closeFollowupReminders() {
    if (reminderItems.length === 0 || busyItemId) return
    setBusyItemId('batch:followups')
    setHiddenItemIds(prev => {
      const next = new Set(prev)
      for (const item of reminderItems) next.add(item.id)
      return next
    })
    let closed = 0
    const failedIds: string[] = []
    try {
      for (const item of reminderItems) {
        const res = await fetch('/api/gtm/work-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, action: 'reviewed', lead_id: item.lead_id, metadata: { type: item.type, batch: 'followup_reminders' } }),
        })
        if (res.ok) closed++
        else failedIds.push(item.id)
      }
      if (failedIds.length > 0) {
        setHiddenItemIds(prev => {
          const next = new Set(prev)
          for (const id of failedIds) next.delete(id)
          return next
        })
      }
      showToast(
        failedIds.length > 0 ? 'error' : 'success',
        failedIds.length > 0
          ? `Closed ${closed}; ${failedIds.length} reminder${failedIds.length === 1 ? '' : 's'} failed.`
          : `Closed ${closed} follow-up reminder${closed === 1 ? '' : 's'}.`,
      )
    } catch {
      setHiddenItemIds(prev => {
        const next = new Set(prev)
        for (const item of reminderItems) next.delete(item.id)
        return next
      })
      showToast('error', 'Unable to close follow-up reminders.')
    } finally {
      setBusyItemId(null)
    }
  }

  function showToast(tone: 'success' | 'error', message: string) {
    setToast({ id: Date.now(), tone, message })
  }

  return (
    <>
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Next Moves</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Work inbox</h3>
        </div>
        <div className="text-right">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-4)] font-semibold">
            Showing {visibleQueueItems.length} of {displayItems.length}
          </span>
          {listIsCapped && <span className="mt-0.5 block text-[10px] text-[var(--color-text-4)]">Showing latest 100</span>}
        </div>
      </div>
      <div className="border-b border-[var(--color-line-1)] bg-white px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-[var(--color-ink-2)] p-1">
            {filterOptions.map(option => (
              <button
                key={option.id}
                onClick={() => {
                  setQueueView(option.id)
                  setVisibleLimit(20)
                }}
                className={`shrink-0 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  queueView === option.id
                    ? 'bg-white text-[var(--color-text-1)] shadow-sm'
                    : 'text-[var(--color-text-4)] hover:text-[var(--color-text-2)]'
                }`}
              >
                {option.label}
                <span className="ml-1.5 text-[10px] text-[var(--color-text-4)]">{option.count}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {reminderItems.length > 0 && (
              <button
                onClick={closeFollowupReminders}
                disabled={Boolean(busyItemId)}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[11px] font-semibold text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)] disabled:opacity-50"
              >
                Close reminders
              </button>
            )}
          </div>
        </div>
      </div>
      {error ? (
        <div className="px-5 py-4 text-xs text-[var(--color-sig-regulation)]">{error}</div>
      ) : queueItems.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-[var(--color-ink-2)] mb-3">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} className="text-[var(--color-text-4)]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">No items in this view</p>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">Switch filters to see other open work.</p>
        </div>
      ) : (
        <div className="space-y-2 px-4 py-4 bg-[var(--color-ink-1)]">
          {/* {queueView === 'priority' && displayItems.length > priorityItems.length && (
            <div className="rounded-lg border border-[var(--color-line-1)] bg-white/85 px-3 py-2 text-[11px] text-[var(--color-text-4)]">
              Showing the top {priorityItems.length} items that need human judgment. Use filters or All for the full queue.
            </div>
          )} */}
          {visibleQueueItems.map(item => (
            <WorkItemRow
              key={item.id}
              item={item}
              busy={busyItemId === item.id}
              onReviewed={() => updateWorkItem(item, 'reviewed')}
              onApproved={() => updateWorkItem(item, 'approved')}
              onDraft={() => openDraftDrawer(item)}
              onBooked={() => updateWorkItem(item, 'booked')}
              onDismissed={() => updateWorkItem(item, 'dismissed')}
            />
          ))}
          {hasMoreItems && (
            <button
              onClick={() => setVisibleLimit(limit => Math.min(queueItems.length, limit + 20))}
              className="w-full rounded-lg border border-[var(--color-line-2)] bg-white px-4 py-3 text-[12px] font-semibold text-[var(--color-text-2)] shadow-sm transition-colors hover:bg-[var(--color-ink-2)]"
            >
              Show 20 more
              <span className="ml-2 text-[11px] font-medium text-[var(--color-text-4)]">
                {queueItems.length - visibleQueueItems.length} remaining
              </span>
            </button>
          )}
        </div>
      )}
    </section>
    <ScreenOverlayPortal>
      {draftDrawer && (
        <DraftDrawer
          state={draftDrawer}
          busy={busyItemId === draftDrawer.item.id}
          onApprove={approveFromDrawer}
          onClose={() => setDraftDrawer(null)}
        />
      )}
      {toast && <WorkToast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />}
    </ScreenOverlayPortal>
    </>
  )
}

function WorkItemRow({
  item,
  busy,
  onReviewed,
  onApproved,
  onDraft,
  onBooked,
  onDismissed,
}: {
  item: GtmWorkItem
  busy: boolean
  onReviewed: () => void
  onApproved: () => void
  onDraft: () => void
  onBooked: () => void
  onDismissed: () => void
}) {
  const domain = item.account_domain ? cleanDomain(item.account_domain) : null
  const why = readableWhy(item)
  const canAct = Boolean(item.lead_id)
  const canDraft = Boolean(item.lead_id && (item.type === 'needs_approval' || item.type === 'new_opportunity'))
  const approveAction = item.type === 'needs_approval'
    ? onApproved
    : item.type === 'reply_detected'
      ? onBooked
      : onReviewed
  const primaryLabel = item.type === 'needs_approval' ? 'Approve'
    : item.type === 'reply_detected' ? 'Booked'
    : 'Review'

  const [nowTime] = useState(() => Date.now())
  const hoursAgo = useMemo(() => Math.round((nowTime - new Date(item.created_at).getTime()) / 3600000), [nowTime, item.created_at])
  const isFresh = hoursAgo < 24
  const isRecent = hoursAgo < 72

  return (
    <div className="group card-flat px-4 py-3 relative">
      <div className="flex items-center gap-4">
        {/* Left: Company + Timing pillar */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isFresh && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: 'var(--color-pillar-timing)' }} />
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: 'var(--color-pillar-timing)' }} />
              </span>
            )}
            {!isFresh && isRecent && (
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--color-pillar-timing)' }} />
            )}
            <p className="truncate text-[13px] font-semibold text-[var(--color-text-1)]">{item.account_name}</p>
            {domain && (
              <a
                href={domain.startsWith('http') ? domain : `https://${domain}`}
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline truncate text-[11px] font-medium text-[var(--color-accent-ring)] hover:text-[var(--color-accent)]"
              >
                {domain}
              </a>
            )}
            <span className="hidden md:inline text-[10px] text-[var(--color-text-4)] shrink-0">{formatDateTime(item.created_at)}</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-[1.5] text-[var(--color-text-3)] truncate">{why}</p>
        </div>

        {/* Center: Accuracy pillar — priority score */}
        <div className="hidden lg:flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1">
            <AccuracyDot score={item.priority} />
            <span className="text-[10px] font-semibold tabular-nums text-[var(--color-text-3)]">{item.priority}</span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {canAct && (
            <button
              onClick={approveAction}
              disabled={busy}
              className="inline-flex h-8 items-center justify-center rounded-lg btn-primary px-3 text-[11px] font-semibold disabled:opacity-50"
            >
              {primaryLabel}
            </button>
          )}

          {/* Hover-reveal secondary actions */}
          <div className="hidden items-center gap-1.5 group-hover:flex">
            {canDraft && (
              <button
                onClick={onDraft}
                disabled={busy}
                title="Preview draft"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line-2)] bg-white text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)] disabled:opacity-50 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
            )}
            <button
              onClick={onDismissed}
              disabled={busy || !item.lead_id}
              title="Dismiss"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line-2)] bg-white text-[var(--color-text-3)] hover:bg-[var(--color-pillar-quality-bg)] hover:text-[var(--color-pillar-quality)] hover:border-[var(--color-pillar-quality-bg)] disabled:opacity-50 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Mobile: always show a compact menu button */}
          <div className="flex items-center gap-1.5 lg:hidden">
            {canDraft && (
              <button
                onClick={onDraft}
                disabled={busy}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] font-medium text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)] disabled:opacity-50"
              >
                Draft
              </button>
            )}
            <button
              onClick={onDismissed}
              disabled={busy || !item.lead_id}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--color-line-2)] bg-white px-2.5 text-[11px] font-medium text-[var(--color-text-3)] hover:bg-[var(--color-ink-2)] disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AccuracyDot({ score }: { score: number }) {
  let color = 'var(--color-text-4)'
  if (score >= 80) color = 'var(--color-pillar-accuracy)'
  else if (score >= 60) color = 'var(--color-pillar-timing)'
  return <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
}

interface OutreachDraftPreview {
  subject: string
  body: string
  to?: string | null
  to_name?: string | null
  cc?: Array<{ name: string; email: string }>
  all?: Array<{ name: string; title: string; email: string; confidence: string; source: string }>
  contact_resolution?: {
    status?: string
    message?: string
    source?: string
    contact_email?: string | null
    contact_name?: string | null
    contact_verified?: boolean
    used_credit?: boolean
    from_cache?: boolean
    resolved_domain?: string | null
    contact_count?: number
  }
}

function DraftDrawer({
  state,
  busy,
  onApprove,
  onClose,
}: {
  state: { item: GtmWorkItem; draft: OutreachDraftPreview | null; loading: boolean; error: string | null }
  busy: boolean
  onApprove: () => void
  onClose: () => void
}) {
  const contactStatus = state.draft?.contact_resolution
  const hasRecipient = Boolean(state.draft?.to)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <button className="flex-1 cursor-default" aria-label="Close draft drawer" onClick={onClose} />
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--color-line-2)] bg-white shadow-2xl">
        <div className="sticky top-0 border-b border-[var(--color-line-1)] bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Draft outreach</p>
              <h3 className="mt-1 text-base font-semibold text-[var(--color-text-1)]">{state.item.account_name}</h3>
              {state.draft?.to && (
                <div className="mt-1 space-y-0.5 text-xs text-[var(--color-text-4)]">
                  <p>To {state.draft.to_name ? `${state.draft.to_name} ` : ''}{state.draft.to}</p>
                  {state.draft.cc && state.draft.cc.length > 0 && (
                    <p>Cc {state.draft.cc.map((r, i) => (
                      <span key={r.email + i}>{r.name ? `${r.name} ` : ''}{r.email}{i < (state.draft?.cc?.length ?? 0) - 1 ? ', ' : ''}</span>
                    ))}</p>
                  )}
                </div>
              )}
            </div>
            <button onClick={onClose} className="rounded-lg border border-[var(--color-line-2)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)]">
              Close
            </button>
          </div>
        </div>
        <div className="space-y-4 px-5 py-4">
          {state.loading && <DraftLoadingState companyName={state.item.account_name} />}
          {state.error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{state.error}</p>}
          {state.draft && (
            <>
              <ContactStatusPanel draft={state.draft} />
              <div className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/35 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Subject</p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">{state.draft.subject}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-line-1)] bg-white px-3 py-3">
                <p className="whitespace-pre-line text-sm leading-6 text-[var(--color-text-2)]">{state.draft.body}</p>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line-1)] pt-3">
                <button onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12px] font-semibold text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)]">
                  Close
                </button>
                <button
                  onClick={onApprove}
                  disabled={busy || !hasRecipient}
                  title={!hasRecipient ? 'Add or discover a contact before approving outreach.' : undefined}
                  className="inline-flex h-9 items-center justify-center rounded-lg btn-primary px-4 text-[12px] font-semibold disabled:opacity-50"
                >
                  {hasRecipient ? 'Approve' : 'Needs contact'}
                </button>
              </div>
              {!hasRecipient && (
                <p className="text-[11px] leading-4 text-[var(--color-text-4)]">
                  {contactStatus?.message ?? 'Draft is ready. Contact discovery has not found a usable recipient yet.'}
                </p>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function ContactStatusPanel({ draft }: { draft: OutreachDraftPreview }) {
  const status = draft.contact_resolution?.status ?? (draft.to ? 'ready' : 'not_found')
  const ready = Boolean(draft.to)
  const toneClass = ready
    ? 'border-[var(--color-pillar-quality-bg)] bg-[var(--color-pillar-quality-bg)]/35'
    : 'border-[var(--color-pillar-timing-bg)] bg-[var(--color-pillar-timing-bg)]/35'
  const dotClass = ready ? 'bg-[var(--color-pillar-quality)]' : 'bg-[var(--color-pillar-timing)]'
  const label = ready ? 'Contacts ready' : status === 'blocked' ? 'Contact blocked' : 'Contact pending'
  const allCount = (draft.all?.length ?? 0) > 0 ? draft.all!.length : (draft.cc?.length ?? 0) + (draft.to ? 1 : 0)
  const detail = ready
    ? allCount > 1
      ? `${draft.to_name ? `${draft.to_name} ` : ''}${draft.to} + ${allCount - 1} more`
      : `${draft.to_name ? `${draft.to_name} ` : ''}${draft.to}`
    : draft.contact_resolution?.message ?? 'No usable contact email is available yet.'

  return (
    <div className={`rounded-lg border px-3 py-3 ${toneClass}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">{label}</p>
          <p className="mt-1 text-[12px] font-semibold text-[var(--color-text-1)]">{detail}</p>
          {ready && draft.all && draft.all.length > 1 && (
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-4)]">
              Draft addresses {draft.all.length} contacts at this company. All will receive this outreach.
            </p>
          )}
          {!ready && (
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-4)]">
              The email below is a draft preview. Approve/send is held until a usable recipient is available.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function WorkToast({
  tone,
  message,
  onClose,
}: {
  tone: 'success' | 'error'
  message: string
  onClose: () => void
}) {
  const toneClass = tone === 'success'
    ? 'border-[var(--color-accent-bg)] bg-white text-[var(--color-text-2)]'
    : 'border-[var(--color-pillar-quality-bg)] bg-[var(--color-pillar-quality-bg)]/30 text-[var(--color-pillar-quality)]'

  return (
    <div className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 text-xs font-medium shadow-xl ${toneClass}`}>
      <span className={`h-2 w-2 rounded-full ${tone === 'success' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-pillar-quality)]'}`} />
      <span className="min-w-0 flex-1">{message}</span>
      <button onClick={onClose} className="rounded-md px-1.5 py-0.5 text-[11px] text-current opacity-60 hover:bg-black/5 hover:opacity-100">
        Close
      </button>
    </div>
  )
}

function DraftLoadingState({ companyName }: { companyName: string }) {
  const [step, setStep] = useState(0)
  const steps = [
    { label: 'Discovering contacts', detail: `Finding the right people at ${companyName}...` },
    { label: 'Verifying emails', detail: 'Checking deliverability and role fit...' },
    { label: 'Writing outreach', detail: `Crafting a personalized message for ${companyName}...` },
    { label: 'Finalizing', detail: 'Almost ready...' },
  ]

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 2500),
      setTimeout(() => setStep(2), 5500),
      setTimeout(() => setStep(3), 9000),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="space-y-5 py-8">
      <div className="flex flex-col items-center text-center">
        <div className="relative h-12 w-12">
          <span className="absolute inset-0 h-12 w-12 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)]" />
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[var(--color-accent-ring)]">
            {Math.min(step + 1, 4)}/{steps.length}
          </span>
        </div>
        <h4 className="mt-4 text-sm font-semibold text-[var(--color-text-1)]">{steps[step]?.label ?? steps[steps.length - 1].label}</h4>
        <p className="mt-1 text-xs text-[var(--color-text-3)] max-w-[280px]">{steps[step]?.detail ?? steps[steps.length - 1].detail}</p>
        <p className="mt-3 text-[11px] text-[var(--color-text-4)]">This usually takes 5–10 seconds.</p>
      </div>

      <div className="space-y-2.5">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-3">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors duration-300 ${
              i < step ? 'bg-[var(--color-accent)] text-white' :
              i === step ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] ring-1 ring-[var(--color-accent)]' :
              'bg-[var(--color-ink-2)] text-[var(--color-text-4)]'
            }`}>
              {i < step ? (
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-[12px] font-medium transition-colors duration-300 ${
              i <= step ? 'text-[var(--color-text-1)]' : 'text-[var(--color-text-4)]'
            }`}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScreenOverlayPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

function isPriorityWorkItem(item: GtmWorkItem): boolean {
  return (
    item.type === 'needs_approval' ||
    item.type === 'reply_detected' ||
    item.type === 'policy_blocked' ||
    item.type === 'workflow_failed' ||
    (item.type === 'new_opportunity' && item.priority >= 72)
  )
}

function filterWorkItems(items: GtmWorkItem[], view: WorkQueueView, priorityItems: GtmWorkItem[]): GtmWorkItem[] {
  switch (view) {
    case 'priority':
      return priorityItems
    case 'approvals':
      return items.filter(item => item.type === 'needs_approval')
    case 'replies':
      return items.filter(item => item.type === 'reply_detected')
    case 'blocked':
      return items.filter(item => item.status === 'blocked' || item.type === 'policy_blocked' || item.type === 'workflow_failed')
    case 'opportunities':
      return items.filter(item => item.type === 'new_opportunity')
    case 'followups':
      return items.filter(item => item.type === 'sent_followup_pending')
    case 'all':
    default:
      return items
  }
}

function cleanDomain(value: string): string {
  return value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
}

function readableWhy(item: GtmWorkItem): string {
  const reason = item.body || item.title
  if (item.type === 'needs_approval') return reason.replace(' is ready for approve-first outreach.', ' is ready for review.')
  if (item.type === 'new_opportunity') return reason
  if (item.type === 'reply_detected') return reason
  if (item.type === 'sent_followup_pending') return 'Outreach was sent and this account is waiting on follow-up timing or a reply.'
  if (item.type === 'policy_blocked') return `Guardrail review needed: ${reason}`
  if (item.type === 'workflow_failed') return `Workflow needs attention: ${reason}`
  return reason
}

function sortByLatestOutcome(a: Lead, b: Lead) {
  return outcomeTime(b) - outcomeTime(a)
}
