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
    <div className="rounded-xl border border-[var(--color-line-2)] bg-white px-4 py-3 flex items-center gap-3">
      <span className="h-2 w-2 rounded-full bg-[var(--color-sig-regulation)]" />
      <p className="text-[12px] text-[var(--color-text-3)]">{error}</p>
    </div>
  )
  if (!readiness) return null

  const statusConfig = {
    blocked:   { label: 'Blocked',    cls: 'bg-red-50 text-red-600' },
    needs_work:{ label: 'Needs work', cls: 'bg-[#fff4df] text-[#936014]' },
    ready:     { label: 'Ready',      cls: 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' },
    running:   { label: 'Running',    cls: 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]' },
  }[readiness.status]

  const nextSegment = readiness.segments.find(segment => !segment.done)

  function act(segmentKey: string) {
    if (segmentKey === 'autopilot') onNavigate('autopilot')
    else if (segmentKey === 'inbox' || segmentKey === 'contacts' || segmentKey === 'credits') onNavigate('settings')
    else if (segmentKey === 'signals' || segmentKey === 'learning') onNavigate('accounts')
    else onNavigate('settings')
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${statusConfig.cls}`}>
        {statusConfig.label}
      </span>
      <span className="text-[12px] text-[var(--color-text-2)]">{readiness.headline}</span>
      {nextSegment && (
        <button onClick={() => act(nextSegment.key)} className="ml-auto text-[11px] font-medium text-[var(--color-accent-ring)] hover:underline">
          {nextSegment.action}
        </button>
      )}
    </div>
  )
}

function WorkInboxPanel({ items, error, fallbackApprovals, onNavigate }: { items: GtmWorkItem[]; error: string | null; fallbackApprovals: Lead[]; onNavigate: (view: View) => void }) {
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [itemMessage, setItemMessage] = useState<string | null>(null)
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set())

  const visibleItems = items.length > 0
    ? items
    : fallbackApprovals.map(lead => ({
        id: `fallback:${lead.id}`,
        type: 'needs_approval',
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
  const openItem = displayItems.find(item => item.id === openItemId) ?? null

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
      setOpenItemId(null)
    } catch { setItemMessage('Unable to update item.') }
    finally { setBusyItemId(null) }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Next Moves</h3>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">The accounts Bombsell believes deserve attention now.</p>
        </div>
      </div>
      {itemMessage && <div className="border-b border-[var(--color-line-1)] px-5 py-2 text-[11px] text-[var(--color-text-3)]">{itemMessage}</div>}
      {error ? (
        <div className="px-5 py-4 text-xs text-[var(--color-sig-regulation)]">{error}</div>
      ) : displayItems.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">No open work items</p>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">The next signal, reply, or blocked action will appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-line-1)]">
          {displayItems.slice(0, 10).map(item => (
            <div key={item.id}>
              <button
                type="button"
                onClick={() => setOpenItemId(prev => prev === item.id ? null : item.id)}
                className="grid w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--color-ink-2)]/50 lg:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-4)]">{item.type.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-2 truncate text-[13px] font-semibold text-[var(--color-text-1)]">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--color-text-3)]">{item.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10.5px] text-[var(--color-text-4)]">
                    <span>{item.account_name}</span>
                    {item.account_domain && <span>{item.account_domain}</span>}
                    <span>{formatDateTime(item.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 lg:justify-end">
                  <span className="rounded-full border border-[var(--color-line-1)] bg-white px-2 py-1 text-[10px] text-[var(--color-text-4)]">
                    P{Math.round(item.priority)}
                  </span>
                  <span className="rounded-full bg-[var(--color-ink-2)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-2)]">
                    {openItemId === item.id ? 'Close' : item.action_label}
                  </span>
                </div>
              </button>
              {openItem?.id === item.id && (
                <div className="border-t border-[var(--color-line-1)] bg-[var(--color-ink-2)]/45 px-5 py-4">
                  <div className="grid gap-3 text-[11.5px] text-[var(--color-text-3)] sm:grid-cols-2">
                    <p><span className="font-medium text-[var(--color-text-1)]">Source:</span> {item.source}</p>
                    <p><span className="font-medium text-[var(--color-text-1)]">Account:</span> {item.account_name}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.lead_id && (
                      <button onClick={() => updateLeadStatus(item, 'viewed')} disabled={busyItemId === item.id} className="rounded-full border border-[var(--color-line-2)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-1)] disabled:opacity-50">
                        Mark reviewed
                      </button>
                    )}
                    {item.type === 'needs_approval' && (
                      <button onClick={() => onNavigate('autopilot')} className="rounded-full btn-primary px-3 py-1.5 text-[11px] font-medium">
                        Review sending mode
                      </button>
                    )}
                    {item.lead_id && item.type === 'reply_detected' && (
                      <button onClick={() => updateLeadStatus(item, 'booked')} disabled={busyItemId === item.id} className="rounded-full btn-primary px-3 py-1.5 text-[11px] font-medium disabled:opacity-50">
                        Mark booked
                      </button>
                    )}
                    {item.lead_id && (
                      <button onClick={() => updateLeadStatus(item, 'dismissed')} disabled={busyItemId === item.id} className="rounded-full border border-[var(--color-line-2)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--color-sig-regulation)] disabled:opacity-50">
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function sortByLatestOutcome(a: Lead, b: Lead) {
  return outcomeTime(b) - outcomeTime(a)
}

function outcomeTime(lead: Lead): number {
  return new Date(lead.booked_at ?? lead.replied_at ?? lead.sent_at ?? lead.created_at).getTime()
}
