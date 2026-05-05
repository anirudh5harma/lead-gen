'use client'

import { useState, useEffect } from 'react'

import type { Lead } from "@/lib/leads"
import type { GtmWorkItem, LaunchReadinessSnapshot, View } from './types'
import { TabLoadingState, StatusBadge, formatDateTime } from './shared'

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
    <div className="space-y-4">
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
  const [itemMessage, setItemMessage] = useState<string | null>(null)
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set())
  const [queueView, setQueueView] = useState<WorkQueueView>('priority')
  const [visibleLimit, setVisibleLimit] = useState(20)

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
    setItemMessage(null)
    try {
      const res = await fetch('/api/gtm/work-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, action, lead_id: item.lead_id, metadata: { type: item.type } }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setItemMessage(data?.error ?? 'Unable to update item.'); return }
      const messages = {
        reviewed: 'Item reviewed.',
        approved: 'Item approved.',
        discussed: 'Item moved to discussion.',
        dismissed: 'Item dismissed.',
        booked: 'Marked booked.',
      }
      setItemMessage(messages[action])
      setHiddenItemIds(prev => new Set(prev).add(item.id))
    } catch { setItemMessage('Unable to update item.') }
    finally { setBusyItemId(null) }
  }

  async function closeFollowupReminders() {
    if (reminderItems.length === 0 || busyItemId) return
    setBusyItemId('batch:followups')
    setItemMessage(null)
    let closed = 0
    try {
      for (const item of reminderItems) {
        const res = await fetch('/api/gtm/work-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, action: 'reviewed', lead_id: item.lead_id, metadata: { type: item.type, batch: 'followup_reminders' } }),
        })
        if (res.ok) {
          closed++
          setHiddenItemIds(prev => new Set(prev).add(item.id))
        }
      }
      setItemMessage(closed > 0 ? `Closed ${closed} follow-up reminder${closed === 1 ? '' : 's'}.` : 'No reminders were closed.')
    } catch {
      setItemMessage('Unable to close follow-up reminders.')
    } finally {
      setBusyItemId(null)
    }
  }

  return (
    <section className="card overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-5 py-4 bg-[var(--color-ink-2)]/30">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Next Moves</h3>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">
            Start with the priority queue, then use filters when you want to clear a specific type of work.
          </p>
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
      {itemMessage && (
        <div className="border-b border-[var(--color-line-1)] px-5 py-2.5 text-[11px] text-[var(--color-accent-ring)] bg-[var(--color-accent-bg)]/40">
          {itemMessage}
        </div>
      )}
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
        <div className="space-y-3 bg-[linear-gradient(180deg,#fffaf2_0%,#f8faf6_100%)] px-4 py-4">
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
              onDiscussed={() => updateWorkItem(item, 'discussed')}
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
  )
}

function WorkItemRow({
  item,
  busy,
  onReviewed,
  onApproved,
  onDiscussed,
  onBooked,
  onDismissed,
}: {
  item: GtmWorkItem
  busy: boolean
  onReviewed: () => void
  onApproved: () => void
  onDiscussed: () => void
  onBooked: () => void
  onDismissed: () => void
}) {
  const presentation = getWorkItemPresentation(item)
  const actionButtons = getActionButtons(item, presentation, busy, onReviewed, onApproved, onDiscussed, onBooked, onDismissed)

  return (
    <div className="group overflow-hidden rounded-xl border border-white/80 bg-white shadow-[0_16px_44px_-34px_rgba(36,28,17,0.9)] ring-1 ring-[var(--color-line-1)]/70 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_56px_-38px_rgba(36,28,17,0.95)]">
      <div className={`h-1 ${presentation.accentClass}`} />
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${presentation.badgeClass}`}>
              {getTypeIcon(item.type)}
              {presentation.label}
            </span>
            <StatusBadge status={item.status} />
            <span className="text-[10px] text-[var(--color-text-4)]">{formatDateTime(item.created_at)}</span>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
            <div className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/35 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Account</p>
              <p className="mt-1 truncate text-[12px] font-semibold text-[var(--color-text-1)]">{item.account_name}</p>
              {item.account_domain && <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-4)]">{item.account_domain}</p>}
              <p className="mt-2 text-[10px] font-semibold text-[var(--color-text-4)]">Priority {Math.round(item.priority)}</p>
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">What happened</p>
              <p className="mt-1 text-[13px] font-semibold text-[var(--color-text-1)]">{item.title}</p>
              <p className="mt-1 text-[11.5px] leading-5 text-[var(--color-text-3)]">{item.body}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-line-1)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaf6_100%)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)]">Recommended next step</p>
          <p className="mt-1 text-[12px] font-semibold text-[var(--color-text-1)]">{presentation.recommendation}</p>
          <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-4)]">{presentation.effect}</p>
          {actionButtons.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {actionButtons}
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-[var(--color-ink-2)] px-3 py-2 text-[11px] text-[var(--color-text-4)]">
              Open the related account or workflow to resolve this item.
            </p>
          )}
        </div>
      </div>
    </div>
  )
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

function getWorkItemPresentation(item: GtmWorkItem) {
  const presentations: Record<string, {
    label: string
    recommendation: string
    effect: string
    accentClass: string
    badgeClass: string
    primaryLabel?: string
    reviewLabel: string
    dismissLabel: string
    discussLabel?: string
    bookedLabel?: string
  }> = {
    needs_approval: {
      label: 'Outreach approval',
      recommendation: 'Approve the prepared outreach only if this account and contact look right.',
      effect: 'Approve outreach marks the plan approved and moves the lead out of the review queue.',
      accentClass: 'bg-[var(--color-accent)]',
      badgeClass: 'border-[var(--color-accent)]/25 bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]',
      primaryLabel: 'Approve outreach',
      reviewLabel: 'Reviewed only',
      dismissLabel: 'Dismiss lead',
    },
    reply_detected: {
      label: 'Reply needs handling',
      recommendation: 'Decide whether this reply needs a discussion or should be counted as booked.',
      effect: 'Discuss removes it from this queue for manual handling. Booked updates the lead status.',
      accentClass: 'bg-[var(--color-sig-expansion)]',
      badgeClass: 'border-[var(--color-sig-expansion)]/20 bg-[var(--color-sig-expansion)]/10 text-[var(--color-sig-expansion)]',
      reviewLabel: 'Reviewed reply',
      dismissLabel: 'Dismiss reply',
      discussLabel: 'Move to discussion',
      bookedLabel: 'Mark booked',
    },
    meeting_booked: {
      label: 'Booked outcome',
      recommendation: 'Review the outcome so learning and account history stay clean.',
      effect: 'Review removes this booked outcome from the open work queue.',
      accentClass: 'bg-[var(--color-sig-expansion)]',
      badgeClass: 'border-[var(--color-sig-expansion)]/20 bg-[var(--color-sig-expansion)]/10 text-[var(--color-sig-expansion)]',
      reviewLabel: 'Archive outcome',
      dismissLabel: 'Dismiss',
    },
    policy_blocked: {
      label: 'Guardrail block',
      recommendation: 'Inspect the guardrail before any outreach proceeds.',
      effect: 'Review records that you inspected the block. Dismiss closes the item.',
      accentClass: 'bg-[var(--color-sig-regulation)]',
      badgeClass: 'border-red-100 bg-red-50 text-red-600',
      reviewLabel: 'Reviewed block',
      dismissLabel: 'Dismiss block',
    },
    workflow_failed: {
      label: 'Workflow issue',
      recommendation: 'Review the failed agent step and decide whether to retry manually.',
      effect: 'Review closes the item; dismiss removes it without action.',
      accentClass: 'bg-[var(--color-sig-regulation)]',
      badgeClass: 'border-red-100 bg-red-50 text-red-600',
      reviewLabel: 'Reviewed issue',
      dismissLabel: 'Dismiss issue',
    },
    workflow_waiting: {
      label: 'Workflow waiting',
      recommendation: 'Check whether the agent is waiting on a prerequisite or external event.',
      effect: 'Review removes the reminder from the work queue.',
      accentClass: 'bg-[#d6a235]',
      badgeClass: 'border-[#f0dcb0] bg-[#fff4df] text-[#936014]',
      reviewLabel: 'Reviewed wait',
      dismissLabel: 'Dismiss wait',
    },
    sent_followup_pending: {
      label: 'Follow-up watch',
      recommendation: 'Keep this account in view while Bombsell watches for replies and follow-up timing.',
      effect: 'Review closes this reminder without changing the sent outreach.',
      accentClass: 'bg-[#d6a235]',
      badgeClass: 'border-[#f0dcb0] bg-[#fff4df] text-[#936014]',
      reviewLabel: 'Close reminder',
      dismissLabel: 'Dismiss lead',
    },
    new_opportunity: {
      label: 'New opportunity',
      recommendation: 'Inspect the account before unlocking contacts or drafting outreach.',
      effect: 'Review marks the account as seen. Dismiss removes the lead from active work.',
      accentClass: 'bg-[var(--color-accent)]',
      badgeClass: 'border-[var(--color-accent)]/25 bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]',
      reviewLabel: 'Mark seen',
      dismissLabel: 'Dismiss lead',
    },
  }

  return presentations[item.type] ?? {
    label: item.type.replace(/_/g, ' '),
    recommendation: item.action_label || 'Inspect this item and decide the next step.',
    effect: 'Review closes the item from this queue. Dismiss removes it from active work.',
    accentClass: 'bg-[var(--color-line-3)]',
    badgeClass: 'border-[var(--color-line-1)] bg-[var(--color-ink-2)] text-[var(--color-text-3)]',
    reviewLabel: 'Reviewed',
    dismissLabel: 'Dismiss',
  }
}

function getTypeIcon(type: string) {
  const icons: Record<string, React.ReactNode> = {
    needs_approval: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.2-7.2a11.2 11.2 0 01-16.4 0A11.2 11.2 0 003 8c0 5.1 3.4 9.7 9 11 5.6-1.3 9-5.9 9-11 0-1.8-.4-3.6-.8-5.2z" /></svg>
    ),
    reply_detected: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
    ),
    meeting_booked: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M9 16l2 2 4-4M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
    ),
    policy_blocked: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
    ),
    workflow_failed: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M4.93 4.93l14.14 14.14M12 22a10 10 0 110-20 10 10 0 010 20z" /></svg>
    ),
    workflow_waiting: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
    sent_followup_pending: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 12H8m8 0l-4-4m4 4l-4 4m9-4a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
    new_opportunity: (
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
    ),
  }
  return icons[type] ?? (
    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  )
}

function getActionButtons(
  item: GtmWorkItem,
  presentation: ReturnType<typeof getWorkItemPresentation>,
  busy: boolean,
  onReviewed: () => void,
  onApproved: () => void,
  onDiscussed: () => void,
  onBooked: () => void,
  onDismissed: () => void,
) {
  const buttons: React.ReactNode[] = []

  if (item.lead_id) {
    buttons.push(
      <button
        key="viewed"
        onClick={onReviewed}
        disabled={busy}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-2 text-[11px] font-semibold text-[var(--color-text-1)] hover:bg-[var(--color-ink-2)] hover:border-[var(--color-line-3)] disabled:opacity-50 transition-all"
        title={presentation.effect}
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        {presentation.reviewLabel}
      </button>
    )
  }

  if (item.type === 'needs_approval') {
    buttons.push(
      <button
        key="approve"
        onClick={onApproved}
        disabled={busy}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg btn-primary px-3 py-2 text-[11px] font-semibold disabled:opacity-50"
        title="Approve the prepared outreach plan for this lead"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        {presentation.primaryLabel}
      </button>
    )
  }

  if (item.lead_id && item.type === 'reply_detected') {
    buttons.push(
      <button
        key="discuss"
        onClick={onDiscussed}
        disabled={busy}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-2 text-[11px] font-semibold text-[var(--color-text-1)] hover:bg-[var(--color-ink-2)] hover:border-[var(--color-line-3)] disabled:opacity-50 transition-all"
        title="Move this reply into manual discussion handling"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4-.82L3 20l1.38-3.45A7.5 7.5 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        {presentation.discussLabel}
      </button>
    )
    buttons.push(
      <button
        key="booked"
        onClick={onBooked}
        disabled={busy}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg btn-primary px-3 py-2 text-[11px] font-semibold disabled:opacity-50"
        title="Mark this lead as booked"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        {presentation.bookedLabel}
      </button>
    )
  }

  if (item.lead_id) {
    buttons.push(
      <button
        key="dismiss"
        onClick={onDismissed}
        disabled={busy}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-line-2)] bg-white px-3 py-2 text-[11px] font-semibold text-[var(--color-sig-regulation)] hover:bg-red-50 hover:border-red-100 disabled:opacity-50 transition-all"
        title="Dismiss this item from active work"
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        {presentation.dismissLabel}
      </button>
    )
  }

  return buttons
}

function sortByLatestOutcome(a: Lead, b: Lead) {
  return outcomeTime(b) - outcomeTime(a)
}
