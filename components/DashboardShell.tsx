'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MAX_CONNECTED_SENDING_ACCOUNTS } from '@/lib/oauth/connected-accounts'
import type { Lead } from '@/lib/leads'
import Sidebar from './Sidebar'
import WatchlistManager from './WatchlistManager'

type View = 'command' | 'automation' | 'signals' | 'accounts' | 'mcp' | 'settings'

interface UserProfile {
  company_name: string
  client_name?: string
  services_description: string
  website_url?: string | null
  icp_keywords: string[] | null
  target_industries?: string[] | null
  email?: string
  plan?: string
  leads_used_this_month?: number
  lead_credit_balance?: number
  slack_webhook_url?: string | null
  slack_min_score?: number | null
  active_client_id?: string | null
  automation_mode?: 'research_only' | 'approve_first' | 'autopilot'
}

interface Props {
  initialLeads: Lead[]
  initialAgentEvents: AgentEvent[]
  userProfile: UserProfile
}

interface AgentEvent {
  id: string
  agent_name: string
  event_type: string
  status: 'planned' | 'running' | 'completed' | 'skipped' | 'blocked' | 'failed' | 'needs_approval'
  title: string
  body: string | null
  lead_id: string | null
  created_at: string
}

interface GtmOpsSnapshot {
  workflow_runs: Array<{
    id: string
    workflow_type: string
    status: string
    current_step: string | null
    started_at: string
    completed_at: string | null
    error_message: string | null
    output?: Record<string, unknown>
  }>
  workflow_steps: Array<{
    id: string
    run_id: string
    step_key: string
    status: string
    error_message: string | null
  }>
  tool_calls: Array<{
    id: string
    run_id: string | null
    tool_name: string
    status: string
    error_message: string | null
  }>
  policy_decisions: Array<{
    id: string
    policy_name: string
    action_type: string
    decision: 'allowed' | 'blocked' | 'needs_approval'
    reasons: string[]
    decided_at: string
  }>
  memories: Array<{
    id: string
    memory_scope: string
    memory_type: string
    content: string
    source: string
    confidence: number
    observed_at: string
  }>
  accounts: Array<{
    id: string
    name: string
    domain: string | null
    lifecycle_stage: string
    last_seen_at: string
  }>
}

interface AutoSendAccount {
  id: string
  provider: 'gmail' | 'outlook'
  email: string
  display_name?: string | null
}

interface GtmWorkItem {
  id: string
  type: string
  status: 'open' | 'blocked' | 'waiting' | 'completed'
  priority: number
  title: string
  body: string
  account_name: string
  account_domain: string | null
  lead_id: string | null
  account_id: string | null
  workflow_run_id: string | null
  policy_decision_id: string | null
  action_label: string
  source: string
  created_at: string
  account_state_url: string | null
}

interface SignalQualitySnapshot {
  totals: { signals: number; high_quality: number; weak: number; with_outcome: number }
  by_type: Array<{ key: string; count: number; avg_quality: number; outcomes: Record<string, number> }>
  by_source: Array<{ key: string; count: number; avg_quality: number; outcomes: Record<string, number> }>
  signals: Array<{
    id: string
    account_id: string | null
    lead_id: string | null
    account_name: string
    account_domain: string | null
    signal_type: string
    headline: string
    summary: string | null
    source_name: string | null
    source_url: string | null
    published_at: string | null
    observed_at: string
    confidence: number
    relevance_score: number
    quality_score: number
    outcome: string
    reason: string
  }>
}

interface AccountMemoryListItem {
  id: string
  name: string
  domain: string | null
  lifecycle_stage: string
  source_kind: string | null
  first_seen_at: string
  last_seen_at: string
  counts: { signals: number; memories: number; touchpoints: number; leads: number }
  outcomes: { sent: number; replied: number; booked: number }
}

interface AccountStateSnapshot {
  account: {
    id: string
    name: string
    domain: string | null
    website_url?: string | null
    lifecycle_stage: string
    source_kind?: string | null
    first_seen_at: string
    last_seen_at: string
  }
  people: Array<{ id: string; email: string | null; name: string | null; title: string | null; verified: boolean | null; last_seen_at: string }>
  signals: Array<{ id: string; signal_type: string; headline: string; summary: string | null; source_name: string | null; source_url: string | null; observed_at: string; confidence: number }>
  touchpoints: Array<{ id: string; type: string; status: string; subject: string | null; body_preview: string | null; occurred_at: string }>
  memories: Array<{ id: string; memory_type: string; content: string; source: string; confidence: number; observed_at: string }>
  leads: Array<{ id: string; target_company: string; relevance_score: number; relevance_reason: string | null; status: string; created_at: string; sent_at: string | null; replied_at: string | null; booked_at: string | null }>
  workflow_runs: Array<{ id: string; workflow_type: string; status: string; current_step: string | null; started_at: string; error_message: string | null }>
  policy_decisions: Array<{ id: string; policy_name: string; action_type: string; decision: string; reasons: string[]; decided_at: string }>
  next_actions: Array<{ type: string; label: string; reason: string; priority: number; lead_id?: string }>
  state_health: { memory_count: number; signal_count: number; person_count: number; touchpoint_count: number; last_seen_at: string }
}

const VIEW_TITLES: Record<View, string> = {
  command:   'Work Inbox',
  automation: 'Workflow Runtime',
  signals:   'Signal Quality',
  accounts:  'Account Memory',
  mcp:       'Agent API',
  settings:  'Settings',
}

export default function DashboardShell({ initialLeads, initialAgentEvents, userProfile }: Props) {
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const requestedView = params.get('view')
      if (requestedView === 'command' || requestedView === 'automation' || requestedView === 'signals' || requestedView === 'accounts' || requestedView === 'mcp' || requestedView === 'settings') {
        return requestedView
      }
    }
    return 'command'
  })
  const [isRefreshing, startTransition] = useTransition()
  const router = useRouter()

  const [leadCreditBalance, setLeadCreditBalance] = useState(userProfile.lead_credit_balance ?? 0)
  const displayProfile = useMemo(() => ({
    ...userProfile,
    lead_credit_balance: leadCreditBalance,
  }), [leadCreditBalance, userProfile])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const paymentId =
      params.get('payment_id') ??
      params.get('paymentId') ??
      params.get('dodo_payment_id') ??
      ''
    const checkoutSessionId =
      params.get('checkout_session_id') ??
      params.get('checkout_session') ??
      params.get('session_id') ??
      params.get('checkout_id') ??
      ''
    const isCreditReturn = params.get('credits') === '1'

    if (isCreditReturn && (paymentId || checkoutSessionId)) {
      let cancelled = false
      ;(async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const res = await fetch('/api/billing/credits/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              payment_id: paymentId || undefined,
              checkout_session_id: checkoutSessionId || undefined,
            }),
          }).catch(() => null)

          const data = await res?.json().catch(() => null) as {
            balance?: number
            pending?: boolean
          } | null

          if (cancelled) return
          if (res?.ok && typeof data?.balance === 'number') {
            setLeadCreditBalance(data.balance)
            router.refresh()
            break
          }
          if (res && !data?.pending && res.status !== 409) break
          await new Promise(resolve => setTimeout(resolve, 1500))
        }

        if (!cancelled) {
          window.history.replaceState({}, '', window.location.pathname)
        }
      })()
      return () => {
        cancelled = true
      }
    }

    if (window.location.search.includes('view=')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [router])

  const [mountedAtMs] = useState(() => Date.now())

  const metrics = useMemo(() => {
    const cutoff = mountedAtMs - 7 * 24 * 60 * 60 * 1000
    const recent = initialLeads.filter(l =>
      (l.origin ?? 'live') === 'live' &&
      new Date(l.created_at).getTime() >= cutoff,
    )
    return {
      signals: recent.length,
      drafted: recent.filter(l => ['drafted', 'sent', 'replied', 'booked'].includes(l.status)).length,
      sent:    recent.filter(l => Boolean(l.sent_at)).length,
      replied: initialLeads.filter(l => Boolean(l.replied_at)).length,
      booked:  recent.filter(l => Boolean(l.booked_at)).length,
    }
  }, [initialLeads, mountedAtMs])

  function refresh() {
    startTransition(() => router.refresh())
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        companyName={userProfile.client_name || userProfile.company_name}
        userEmail={userProfile.email}
        activeView={activeView}
        onNavigate={v => setActiveView(v)}
      />

      <div className="flex-1 min-w-0 flex flex-col bg-[var(--color-ink-1)]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 h-16 border-b border-[var(--color-line-1)] bg-[var(--color-ink-1)]/85 backdrop-blur-md">
          <div className="h-full flex items-center px-6 gap-5 pl-16 md:pl-6">
            <div className="min-w-0">
              <h1 className="text-[15px] font-medium text-[var(--color-text-1)] tracking-tight truncate">
                {VIEW_TITLES[activeView]}
              </h1>
              <p className="text-[11px] text-[var(--color-text-3)] truncate">
                {activeView === 'command' && 'Find the right accounts. Move the work safely.'}
                {activeView === 'automation' && 'Durable workflow policies, source selection, inbox rotation, and pacing'}
                {activeView === 'signals' && 'Captured account movement, quality scoring, source feedback, and signal outcomes'}
                {activeView === 'accounts' && 'Durable account graph, memory, signals, touchpoints, and next actions'}
                {activeView === 'mcp' && 'Programmable account state, work items, memory, and safe GTM tools'}
                {activeView === 'settings' && 'Memory inputs, integrations, inboxes, policies, credits, and guardrails'}
              </p>
            </div>

            {/* Inline metrics */}
            {activeView === 'command' && (
              <div className="hidden lg:flex items-center gap-2 ml-6">
                <MetricChip value={metrics.sent} label="Sent" />
                <MetricChip value={metrics.replied} label="Replies" />
                <MetricChip value={metrics.booked} label="Booked" accent />
              </div>
            )}
            {/* Right side */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={refresh}
                disabled={isRefreshing}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-ink-2)] disabled:opacity-50 transition-colors"
                title="Refresh"
              >
                <svg
                  className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 014.582 15M19.419 15H15" />
                </svg>
              </button>
              {activeView === 'command' && (
                <button
                  onClick={() => setActiveView('settings')}
                  className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-white px-3 text-[12px] font-semibold text-[var(--color-text-2)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text-1)] transition-colors"
                  title="Lead credit balance"
                >
                  <span className="tabular-nums text-[var(--color-accent-ring)]">{leadCreditBalance}</span>
                  <span>credits</span>
                </button>
              )}
              <button
                onClick={() => setActiveView('settings')}
                className="hidden sm:inline-flex h-9 px-3.5 rounded-full btn-primary text-[12.5px] font-medium items-center gap-1.5"
              >
                Add credits
              </button>
              <LogoutButton />
            </div>
          </div>
        </header>

            {/* View content */}
        <main className="flex-1 px-6 py-6 pb-20 overflow-auto">
          <div className="max-w-6xl mx-auto fade-in">
            {activeView === 'command' && (
              <CommandCenter
                leads={initialLeads}
                events={initialAgentEvents}
                profile={displayProfile}
                onNavigate={setActiveView}
              />
            )}
            {activeView === 'automation' && (
              <AutomationPanel />
            )}
            {activeView === 'signals' && (
              <SignalQualityPanel />
            )}
            {activeView === 'accounts' && (
              <AccountMemoryPanel />
            )}
            {activeView === 'mcp' && (
              <McpPanel />
            )}
            {activeView === 'settings' && (
              <SettingsPanel profile={displayProfile} />
            )}
          </div>
        </main>

      </div>
    </div>
  )
}

function MetricChip({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-[12px] ${
      accent
        ? 'border-[var(--color-accent)]/25 bg-[var(--color-accent-bg)]'
        : 'border-[var(--color-line-1)] bg-white'
    }`}>
      <span className={`font-semibold tabular-nums ${accent ? 'text-[var(--color-accent-ring)]' : 'text-[var(--color-text-1)]'}`}>
        {value}
      </span>
      <span className="text-[11px] text-[var(--color-text-3)]">{label}</span>
    </div>
  )
}

function MiniStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line-1)] bg-white px-3 py-3">
      <p className="text-xl font-semibold tracking-tight text-[var(--color-text-1)]">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-4)]">{label}</p>
    </div>
  )
}

function TabLoadingState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
            <p className="mt-1 text-xs text-[var(--color-text-4)]">{detail}</p>
          </div>
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-3xl border border-[var(--color-line-1)] bg-white" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
        <div className="h-80 animate-pulse rounded-3xl border border-[var(--color-line-1)] bg-white" />
        <div className="h-80 animate-pulse rounded-3xl border border-[var(--color-line-1)] bg-white" />
      </div>
    </div>
  )
}

function CommandCenter({
  leads,
  events,
  profile,
  onNavigate,
}: {
  leads: Lead[]
  events: AgentEvent[]
  profile: UserProfile
  onNavigate: (view: View) => void
}) {
  const [autopilot, setAutopilot] = useState<AutopilotStatus | null>(null)
  const [autopilotLoaded, setAutopilotLoaded] = useState(false)
  const [autopilotBusy, setAutopilotBusy] = useState(false)
  const [autopilotMessage, setAutopilotMessage] = useState<string | null>(null)
  const [opsSnapshot, setOpsSnapshot] = useState<GtmOpsSnapshot | null>(null)
  const [opsError, setOpsError] = useState<string | null>(null)
  const [opsLoaded, setOpsLoaded] = useState(false)
  const [workItems, setWorkItems] = useState<GtmWorkItem[]>([])
  const [workItemsError, setWorkItemsError] = useState<string | null>(null)
  const [workItemsLoaded, setWorkItemsLoaded] = useState(false)
  const [now] = useState(() => Date.now())
  const [todayKey] = useState(() => new Date().toISOString().slice(0, 10))
  const lastSevenDays = now - 7 * 24 * 60 * 60 * 1000
  const recentLeads = leads.filter(lead => new Date(lead.created_at).getTime() >= lastSevenDays)
  const sent = leads.filter(lead => Boolean(lead.sent_at)).sort(sortByLatestOutcome)
  const replies = leads.filter(lead => lead.status === 'replied' || Boolean(lead.replied_at)).sort(sortByLatestOutcome)
  const booked = leads.filter(lead => lead.status === 'booked' || Boolean(lead.booked_at)).sort(sortByLatestOutcome)
  const approvals = leads
    .filter(lead => lead.status === 'drafted' || (lead.is_unlocked === true && Boolean(lead.contact_email) && !lead.sent_at))
    .sort(sortByLatestOutcome)
  const activeEvents = events
  const sentToday = sent.filter(lead => lead.sent_at && lead.sent_at.slice(0, 10) === todayKey).length
  const replyRate = sent.length > 0 ? Math.round((replies.length / sent.length) * 100) : 0

  useEffect(() => {
    let cancelled = false
    fetch('/api/autopilot', { cache: 'no-store' })
      .then(res => res.json() as Promise<AutopilotStatus>)
      .then(data => {
        if (cancelled) return
        setAutopilot(data)
        setAutopilotLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setAutopilotMessage('Unable to load autopilot status.')
          setAutopilotLoaded(true)
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/gtm/ops', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as (GtmOpsSnapshot & { error?: string }) | null
        if (cancelled) return
        if (!res.ok || !data) {
          setOpsError(data?.error ?? 'Unable to load GTM infrastructure trace.')
          setOpsLoaded(true)
          return
        }
        setOpsSnapshot(data)
        setOpsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setOpsError('Unable to load GTM infrastructure trace.')
          setOpsLoaded(true)
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
          setWorkItemsError(data?.error ?? 'Unable to load work items.')
          setWorkItemsLoaded(true)
          return
        }
        setWorkItems(data.work_items ?? [])
        setWorkItemsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setWorkItemsError('Unable to load work items.')
          setWorkItemsLoaded(true)
        }
      })
    return () => { cancelled = true }
  }, [])

  const startAutopilot = useCallback(async (mode: 'approve_first' | 'autopilot') => {
    setAutopilotBusy(true)
    setAutopilotMessage(null)
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const data = await res.json().catch(() => null) as (AutopilotStatus & { error?: string }) | null
      if (!res.ok) {
        setAutopilotMessage(data?.error ?? 'Unable to start autopilot.')
        const readiness = data?.readiness
        if (readiness) {
          setAutopilot(prev => prev
            ? { ...prev, readiness, ready: readiness.every(item => item.done) }
            : data)
        }
        return
      }
      setAutopilot(prev => prev ? { ...prev, mode, policy: { ...(prev.policy ?? {}), enabled: mode === 'autopilot' } } : data)
      setAutopilotMessage(mode === 'autopilot' ? 'Live Autopilot is on.' : 'Live Autopilot is paused.')
    } catch {
      setAutopilotMessage('Unable to start autopilot.')
    } finally {
      setAutopilotBusy(false)
    }
  }, [])

  const commandLoaded = autopilotLoaded && opsLoaded && workItemsLoaded
  if (!commandLoaded) {
    return <TabLoadingState title="Loading Live Autopilot" detail="Fetching runtime status, work inbox, infrastructure trace, and observatory events." />
  }

  return (
    <div className="space-y-4">
      <LiveAutopilotControl
        profile={profile}
        status={autopilot}
        busy={autopilotBusy}
        message={autopilotMessage}
        onStartAutopilot={() => startAutopilot('autopilot')}
        onPauseAutopilot={() => startAutopilot('approve_first')}
        onNavigate={onNavigate}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OutcomeCard label="Sent today" value={sentToday} detail={`${sent.length} total sent`} tone="neutral" />
        <OutcomeCard label="Replies" value={replies.length} detail={`${replyRate}% reply rate`} tone="reply" />
        <OutcomeCard label="Booked" value={booked.length} detail="Meetings marked booked" tone="booked" />
        <OutcomeCard label="Needs review" value={approvals.length} detail="Drafts or ready leads" tone="approval" />
      </div>

      <GtmInfrastructureTrace snapshot={opsSnapshot} error={opsError} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
        <WorkInboxPanel items={workItems} error={workItemsError} fallbackApprovals={approvals.slice(0, 4)} onNavigate={onNavigate} />

        <ObservatoryPanel snapshot={opsSnapshot} workItems={workItems} events={activeEvents} />
      </div>

      <p className="text-[11px] text-[var(--color-text-4)]">
        {recentLeads.length} recent accounts monitored. Safety checks enforce verified contacts, unsubscribes, bounce suppression, caps, and pacing.
      </p>
    </div>
  )
}

function WorkInboxPanel({
  items,
  error,
  fallbackApprovals,
  onNavigate,
}: {
  items: GtmWorkItem[]
  error: string | null
  fallbackApprovals: Lead[]
  onNavigate: (view: View) => void
}) {
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
        body: lead.contact_email
          ? `${lead.contact_email} is ready for workflow-safe sending.`
          : lead.relevance_reason ?? 'Ready for review.',
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
      if (!res.ok) {
        setItemMessage(data?.error ?? 'Unable to update item.')
        return
      }
      setItemMessage(status === 'dismissed' ? 'Item dismissed.' : status === 'booked' ? 'Marked booked.' : 'Marked viewed.')
      setHiddenItemIds(prev => new Set(prev).add(item.id))
      setOpenItemId(null)
    } catch {
      setItemMessage('Unable to update item.')
    } finally {
      setBusyItemId(null)
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Agent Work Inbox</h3>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">Review-ready outreach, replies, booked meetings, policy blocks, and workflow recovery.</p>
        </div>
        <MetricChip value={displayItems.length} label="Items" accent={displayItems.some(item => item.status === 'blocked')} />
      </div>
      {itemMessage && <div className="border-b border-[var(--color-line-1)] px-5 py-2 text-[11px] text-[var(--color-text-3)]">{itemMessage}</div>}
      {error ? (
        <div className="px-5 py-4 text-xs text-[var(--color-sig-regulation)]">{error}</div>
      ) : displayItems.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-medium text-[var(--color-text-1)]">No open work items</p>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">The next signal, reply, policy block, or workflow run will appear here.</p>
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
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${workStatusClass(item.status)}`}>
                      {item.status}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-4)]">{item.type.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-2 truncate text-[13px] font-semibold text-[var(--color-text-1)]">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--color-text-3)]">{item.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10.5px] text-[var(--color-text-4)]">
                    <span>{item.account_name}</span>
                    {item.account_domain && <span>{item.account_domain}</span>}
                    <span>{new Date(item.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
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
                    {item.workflow_run_id && <p><span className="font-medium text-[var(--color-text-1)]">Workflow:</span> {item.workflow_run_id.slice(0, 8)}</p>}
                    {item.policy_decision_id && <p><span className="font-medium text-[var(--color-text-1)]">Policy:</span> {item.policy_decision_id.slice(0, 8)}</p>}
                  </div>
                  <OutreachPlanCard item={item} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.lead_id && (
                      <button onClick={() => updateLeadStatus(item, 'viewed')} disabled={busyItemId === item.id} className="rounded-full border border-[var(--color-line-2)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-1)] disabled:opacity-50">
                        Mark reviewed
                      </button>
                    )}
                    {item.type === 'needs_approval' && (
                      <button onClick={() => onNavigate('automation')} className="rounded-full btn-primary px-3 py-1.5 text-[11px] font-medium">
                        Configure sending
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

function OutreachPlanCard({ item }: { item: GtmWorkItem }) {
  const plan = buildOutreachPlan(item)
  if (!plan) return null

  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-line-1)] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Outreach Plan</p>
        <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-4)]">{plan.safety}</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <PlanFact label="Trigger" value={plan.trigger} />
        <PlanFact label="Persona" value={plan.persona} />
        <PlanFact label="Angle" value={plan.angle} />
      </div>
    </div>
  )
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-1 text-[11.5px] leading-5 text-[var(--color-text-2)]">{value}</p>
    </div>
  )
}

function buildOutreachPlan(item: GtmWorkItem): { trigger: string; persona: string; angle: string; safety: string } | null {
  if (!['needs_approval', 'new_opportunity', 'policy_blocked'].includes(item.type)) return null
  const type = item.type.replace(/_/g, ' ')
  const trigger = item.body || `${type} surfaced for ${item.account_name}.`
  const persona = inferPersona(item)
  const safety = item.status === 'blocked'
    ? 'Policy review required'
    : item.lead_id
      ? 'Guardrails required before send'
      : 'Research only'
  return {
    trigger,
    persona,
    angle: `Tie the outreach to the recent ${type} and the account-specific fit reason. Avoid generic claims.`,
    safety,
  }
}

function inferPersona(item: GtmWorkItem): string {
  const text = `${item.title} ${item.body}`.toLowerCase()
  if (text.includes('security') || text.includes('compliance') || text.includes('regulation')) return 'Security, risk, or compliance owner'
  if (text.includes('hiring') || text.includes('people') || text.includes('talent')) return 'People, talent, or department leader'
  if (text.includes('funding') || text.includes('growth') || text.includes('expansion')) return 'Growth, operations, or revenue leader'
  if (text.includes('product') || text.includes('launch')) return 'Product, growth, or GTM leader'
  return 'Relevant functional owner for the trigger'
}

function ObservatoryPanel({
  snapshot,
  workItems,
  events,
}: {
  snapshot: GtmOpsSnapshot | null
  workItems: GtmWorkItem[]
  events: AgentEvent[]
}) {
  const running = (snapshot?.workflow_runs ?? []).filter(run => run.status === 'running' || run.status === 'waiting').length
  const failed = (snapshot?.workflow_runs ?? []).filter(run => run.status === 'failed').length
  const blocked = workItems.filter(item => item.status === 'blocked').length
  const memories = snapshot?.memories.length ?? 0

  return (
    <section className="card flex max-h-[720px] min-h-0 flex-col overflow-hidden">
      <div className="border-b border-[var(--color-line-1)] px-5 py-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Observatory</h3>
        <p className="mt-1 text-xs text-[var(--color-text-4)]">Workflow health, memory freshness, and execution risk.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4">
        <MiniStat value={running} label="Running" />
        <MiniStat value={failed} label="Failed" />
        <MiniStat value={blocked} label="Blocked" />
        <MiniStat value={memories} label="Memories" />
      </div>
      <div className="border-t border-[var(--color-line-1)] px-5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Recent Agent Events</p>
      </div>
      {events.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-[var(--color-text-4)]">No agent events yet.</div>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-[var(--color-line-1)] overflow-y-auto pb-6">
          {events.map(event => (
            <AgentEventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </section>
  )
}

function workStatusClass(status: GtmWorkItem['status']): string {
  if (status === 'blocked') return 'bg-red-50 text-red-600'
  if (status === 'completed') return 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
  if (status === 'waiting') return 'bg-[#fff4df] text-[#936014]'
  return 'bg-[var(--color-ink-2)] text-[var(--color-text-2)]'
}

function GtmInfrastructureTrace({ snapshot, error }: { snapshot: GtmOpsSnapshot | null; error: string | null }) {
  const latestRuns = snapshot?.workflow_runs ?? []
  const blockedPolicies = (snapshot?.policy_decisions ?? []).filter(decision => decision.decision !== 'allowed')
  const recentMemories = snapshot?.memories ?? []
  const accounts = snapshot?.accounts ?? []
  const toolFailures = (snapshot?.tool_calls ?? []).filter(call => call.status === 'failed' || call.status === 'blocked')

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Infrastructure Trace</h3>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">Durable workflows, policies, tool calls, graph entities, and memory.</p>
        </div>
        {snapshot && (
          <div className="flex flex-wrap gap-2">
            <MetricChip value={latestRuns.length} label="Runs" />
            <MetricChip value={accounts.length} label="Accounts" />
            <MetricChip value={blockedPolicies.length} label="Blocks" accent={blockedPolicies.length > 0} />
          </div>
        )}
      </div>
      {error ? (
        <div className="px-5 py-4 text-xs text-[var(--color-sig-regulation)]">{error}</div>
      ) : !snapshot ? (
        <div className="px-5 py-8 text-center text-xs text-[var(--color-text-4)]">Loading trace.</div>
      ) : latestRuns.length === 0 && recentMemories.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium text-[var(--color-text-1)]">No infrastructure runs yet</p>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">The next send, follow-up, or reply will create a trace.</p>
        </div>
      ) : (
        <div className="grid divide-y divide-[var(--color-line-1)] lg:grid-cols-[minmax(0,1fr)_360px] lg:divide-x lg:divide-y-0">
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Workflow Runs</h4>
              {toolFailures.length > 0 && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
                  {toolFailures.length} tool issue{toolFailures.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {latestRuns.slice(0, 6).map(run => (
                <div key={run.id} className="rounded-2xl border border-[var(--color-line-1)] bg-white px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold text-[var(--color-text-1)]">{run.workflow_type.replace(/_/g, ' ')}</p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-4)]">
                        {run.current_step ? `Step: ${run.current_step}` : `Started ${new Date(run.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                      </p>
                      {run.error_message && <p className="mt-1 text-[11px] text-[var(--color-sig-regulation)]">{run.error_message}</p>}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                      run.status === 'completed'
                        ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
                        : run.status === 'failed'
                          ? 'bg-red-50 text-red-600'
                          : 'bg-[var(--color-ink-2)] text-[var(--color-text-3)]'
                    }`}>
                      {run.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="p-5">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Recent Memory</h4>
            <div className="space-y-2">
              {recentMemories.slice(0, 5).map(memory => (
                <div key={memory.id} className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/45 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent-ring)]">{memory.memory_type.replace(/_/g, ' ')}</p>
                    <span className="text-[10px] text-[var(--color-text-4)]">{Math.round(memory.confidence * 100)}%</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--color-text-3)]">{memory.content}</p>
                  <p className="mt-1 text-[10px] text-[var(--color-text-4)]">{memory.source}</p>
                </div>
              ))}
              {recentMemories.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--color-line-2)] px-4 py-6 text-center text-xs text-[var(--color-text-4)]">No memories recorded yet.</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

interface AutopilotStatus {
  mode?: 'research_only' | 'approve_first' | 'autopilot'
  ready?: boolean
  readiness?: Array<{ key: string; label: string; done: boolean; action: string }>
  connected_accounts?: Array<{ id: string; email: string; provider: string }>
  policy?: { enabled?: boolean } | null
  counts?: { ready: number; sent: number; replied: number; booked: number }
  error?: string
}

function LiveAutopilotControl({
  profile,
  status,
  busy,
  message,
  onStartAutopilot,
  onPauseAutopilot,
  onNavigate,
}: {
  profile: UserProfile
  status: AutopilotStatus | null
  busy: boolean
  message: string | null
  onStartAutopilot: () => void
  onPauseAutopilot: () => void
  onNavigate: (view: View) => void
}) {
  const router = useRouter()
  const mode = status?.mode ?? profile.automation_mode ?? 'approve_first'
  const ready = status?.ready ?? false
  const checklist = status?.readiness ?? [
    { key: 'profile', label: 'Offer and company profile', done: Boolean(profile.company_name && profile.services_description), action: 'Edit onboarding' },
    { key: 'website', label: 'Website for personalization', done: Boolean(profile.website_url), action: 'Add website' },
    { key: 'icp', label: 'ICP targets', done: Boolean(profile.icp_keywords?.length || profile.target_industries?.length), action: 'Tune ICP' },
    { key: 'inbox', label: 'Connected sending inbox', done: false, action: 'Connect inbox' },
    { key: 'credits', label: 'Lead unlock credits', done: (profile.lead_credit_balance ?? 0) > 0, action: 'Add credits' },
  ]
  const completed = checklist.filter(item => item.done).length

  function routeFor(item: { key: string }) {
    if (item.key === 'inbox') onNavigate('settings')
    else if (item.key === 'credits') onNavigate('settings')
    else router.push('/onboarding')
  }

  return (
    <section className="card overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Live Autopilot</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-text-1)]">
                {mode === 'autopilot' ? 'Running' : 'Paused'}
              </h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--color-text-3)]">
                Monitors live signals, prepares account work, and sends only within your guardrails.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={onStartAutopilot} disabled={busy || !ready} className="rounded-full btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50">
                {mode === 'autopilot' ? 'Running' : 'Turn on'}
              </button>
              <button onClick={onPauseAutopilot} disabled={busy} className="rounded-full border border-[var(--color-line-2)] bg-white px-4 py-2 text-xs font-semibold text-[var(--color-text-1)] disabled:opacity-50">
                Pause
              </button>
            </div>
          </div>
          {message && <p className="mt-3 text-xs text-[var(--color-text-3)]">{message}</p>}
          {!ready && (
            <div className="mt-4 flex flex-wrap gap-2">
              {checklist.filter(item => !item.done).map(item => (
                <button key={item.key} onClick={() => routeFor(item)} className="rounded-full border border-[var(--color-line-2)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-2)] hover:text-[var(--color-text-1)]">
                  {item.action}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[var(--color-ink-2)] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Readiness</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-text-1)]">{completed}/{checklist.length}</p>
          <p className="mt-1 text-[11px] text-[var(--color-text-4)]">Credits, inbox, ICP, profile.</p>
        </div>
      </div>
    </section>
  )
}

function OutcomeCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: number
  detail: string
  tone: 'neutral' | 'reply' | 'booked' | 'approval'
}) {
  const toneClass = {
    neutral: 'bg-white',
    reply: 'bg-[var(--color-accent-bg)]',
    booked: 'bg-[#e1f1e4]',
    approval: 'bg-[#fff4df]',
  }[tone]

  return (
    <div className={`rounded-3xl border border-[var(--color-line-1)] ${toneClass} px-5 py-4`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-text-1)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-3)]">{detail}</p>
    </div>
  )
}

function AgentEventRow({ event }: { event: AgentEvent }) {
  const statusColor = event.status === 'completed'
    ? 'bg-[var(--color-sig-funding)]'
    : event.status === 'failed' || event.status === 'blocked'
      ? 'bg-[var(--color-sig-regulation)]'
      : event.status === 'needs_approval'
        ? 'bg-[#d99622]'
        : 'bg-[var(--color-accent)]'

  return (
    <div className="px-5 py-3">
      <div className="flex gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusColor}`} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12.5px] font-semibold text-[var(--color-text-1)]">{event.title}</p>
            <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-4)]">
              {event.agent_name}
            </span>
          </div>
          {event.body && <p className="mt-1 text-[11.5px] leading-5 text-[var(--color-text-3)]">{event.body}</p>}
          <p className="mt-1 text-[10.5px] text-[var(--color-text-4)]">{new Date(event.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        </div>
      </div>
    </div>
  )
}

function sortByLatestOutcome(a: Lead, b: Lead) {
  return outcomeTime(b) - outcomeTime(a)
}

function outcomeTime(lead: Lead): number {
  return new Date(lead.booked_at ?? lead.replied_at ?? lead.sent_at ?? lead.created_at).getTime()
}

function SignalQualityPanel() {
  const [snapshot, setSnapshot] = useState<SignalQualitySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/gtm/signal-quality?limit=80', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as (SignalQualitySnapshot & { error?: string }) | null
        if (cancelled) return
        if (!res.ok || !data) {
          setError(data?.error ?? 'Unable to load signal quality.')
          return
        }
        setSnapshot(data)
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load signal quality.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!snapshot && !error) {
    return <TabLoadingState title="Loading Signal Quality" detail="Fetching captured signals, source feedback, account matches, and outcomes." />
  }

  if (error) return <PanelError title="Signal Quality" message={error} />

  const signals = snapshot?.signals ?? []
  const topTypes = snapshot?.by_type.slice(0, 4) ?? []
  const topSources = snapshot?.by_source.slice(0, 4) ?? []

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OutcomeCard label="Captured" value={snapshot?.totals.signals ?? 0} detail="Recent graph signals" tone="neutral" />
        <OutcomeCard label="High quality" value={snapshot?.totals.high_quality ?? 0} detail="Quality score 70+" tone="booked" />
        <OutcomeCard label="With outcome" value={snapshot?.totals.with_outcome ?? 0} detail="Sent, replied, or booked" tone="reply" />
        <OutcomeCard label="Weak" value={snapshot?.totals.weak ?? 0} detail="Needs source or scoring review" tone="approval" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SignalAggregateCard title="Signal Types" rows={topTypes} />
        <SignalAggregateCard title="Sources" rows={topSources} />
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Signal Review Queue</h2>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">Signals are ranked by confidence, account fit, and historical outcome feedback.</p>
        </div>
        {signals.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-[var(--color-text-4)]">No captured signals yet.</div>
        ) : (
          <div className="divide-y divide-[var(--color-line-1)]">
            {signals.map(signal => (
              <div key={signal.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_180px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-3)]">{signal.signal_type.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-4)]">{signal.source_name ?? 'source'}</span>
                    <span className="text-[10px] text-[var(--color-text-4)]">{formatShortDate(signal.observed_at)}</span>
                  </div>
                  <p className="mt-2 truncate text-[13px] font-semibold text-[var(--color-text-1)]">{signal.headline}</p>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--color-text-3)]">{signal.reason}</p>
                  <p className="mt-2 text-[10.5px] text-[var(--color-text-4)]">{signal.account_name}{signal.account_domain ? ` · ${signal.account_domain}` : ''}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center lg:grid-cols-1 lg:text-right">
                  <ScorePill label="Quality" value={signal.quality_score} />
                  <ScorePill label="Fit" value={signal.relevance_score * 10} />
                  <span className="self-center rounded-full border border-[var(--color-line-1)] bg-white px-2 py-1 text-[10.5px] font-medium text-[var(--color-text-3)]">{signal.outcome}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SignalAggregateCard({ title, rows }: { title: string; rows: SignalQualitySnapshot['by_type'] }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-[var(--color-line-1)] px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
      </div>
      <div className="divide-y divide-[var(--color-line-1)]">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-xs text-[var(--color-text-4)]">No data yet.</p>
        ) : rows.map(row => (
          <div key={row.key} className="flex items-center justify-between gap-4 px-5 py-3">
            <div>
              <p className="text-[12.5px] font-semibold text-[var(--color-text-1)]">{row.key.replace(/_/g, ' ')}</p>
              <p className="mt-0.5 text-[10.5px] text-[var(--color-text-4)]">{row.count} signals · {Object.keys(row.outcomes).join(', ') || 'no outcomes'}</p>
            </div>
            <ScorePill label="Avg" value={row.avg_quality} />
          </div>
        ))}
      </div>
    </section>
  )
}

function AccountMemoryPanel() {
  const [accounts, setAccounts] = useState<AccountMemoryListItem[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [accountState, setAccountState] = useState<AccountStateSnapshot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/gtm/accounts?limit=50', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as { accounts?: AccountMemoryListItem[]; error?: string } | null
        if (cancelled) return
        if (!res.ok || !data) {
          setError(data?.error ?? 'Unable to load accounts.')
          setLoaded(true)
          return
        }
        const nextAccounts = data.accounts ?? []
        setAccounts(nextAccounts)
        setSelectedAccountId(nextAccounts[0]?.id ?? null)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Unable to load accounts.')
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    fetch(`/api/gtm/accounts/${selectedAccountId}/state`, { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as (AccountStateSnapshot & { error?: string }) | null
        if (cancelled) return
        if (!res.ok || !data) {
          setError(data?.error ?? 'Unable to load account state.')
          return
        }
        setAccountState(data)
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load account state.')
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  if (!loaded) {
    return <TabLoadingState title="Loading Account Memory" detail="Fetching account graph, memories, signals, touchpoints, and next actions." />
  }

  if (error && accounts.length === 0) return <PanelError title="Account Memory" message={error} />

  const stateLoading = Boolean(selectedAccountId && accountState?.account.id !== selectedAccountId)

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="card overflow-hidden">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Accounts</h2>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">{accounts.length} memory-backed accounts</p>
        </div>
        <div className="max-h-[720px] divide-y divide-[var(--color-line-1)] overflow-y-auto">
          {accounts.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-[var(--color-text-4)]">No account memory yet.</p>
          ) : accounts.map(account => (
            <button
              key={account.id}
              onClick={() => setSelectedAccountId(account.id)}
              className={`w-full px-5 py-4 text-left transition-colors hover:bg-[var(--color-ink-2)] ${selectedAccountId === account.id ? 'bg-[var(--color-accent-bg)]' : ''}`}
            >
              <p className="truncate text-[13px] font-semibold text-[var(--color-text-1)]">{account.name}</p>
              <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-4)]">{account.domain ?? account.lifecycle_stage}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <SmallCount label="sig" value={account.counts.signals} />
                <SmallCount label="mem" value={account.counts.memories} />
                <SmallCount label="touch" value={account.counts.touchpoints} />
                {account.outcomes.booked > 0 && <SmallCount label="booked" value={account.outcomes.booked} accent />}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="card min-h-[520px] overflow-hidden">
        {stateLoading ? (
          <div className="p-5">
            <div className="h-32 animate-pulse rounded-2xl bg-[var(--color-ink-2)]" />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="h-48 animate-pulse rounded-2xl bg-[var(--color-ink-2)]" />
              <div className="h-48 animate-pulse rounded-2xl bg-[var(--color-ink-2)]" />
            </div>
          </div>
        ) : accountState ? (
          <AccountStateDetail state={accountState} />
        ) : (
          <div className="px-5 py-12 text-center text-xs text-[var(--color-text-4)]">Select an account to inspect memory.</div>
        )}
      </section>
    </div>
  )
}

function AccountStateDetail({ state }: { state: AccountStateSnapshot }) {
  return (
    <div>
      <div className="border-b border-[var(--color-line-1)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[var(--color-text-1)]">{state.account.name}</h2>
            <p className="mt-1 text-xs text-[var(--color-text-4)]">{state.account.domain ?? 'No domain'} · Last seen {formatShortDate(state.account.last_seen_at)}</p>
          </div>
          <span className="rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-2.5 py-1 text-[10px] font-medium text-[var(--color-text-3)]">{state.account.lifecycle_stage}</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <MiniStat label="Signals" value={state.state_health.signal_count} />
          <MiniStat label="Memories" value={state.state_health.memory_count} />
          <MiniStat label="People" value={state.state_health.person_count} />
          <MiniStat label="Touches" value={state.state_health.touchpoint_count} />
        </div>
      </div>

      <div className="grid divide-y divide-[var(--color-line-1)] lg:grid-cols-[minmax(0,1fr)_340px] lg:divide-x lg:divide-y-0">
        <div className="space-y-5 p-5">
          <AccountSection title="Next Actions">
            {state.next_actions.length === 0 ? (
              <EmptyLine>No recommended action.</EmptyLine>
            ) : state.next_actions.map(action => (
              <div key={`${action.type}:${action.lead_id ?? action.reason}`} className="rounded-2xl border border-[var(--color-line-1)] bg-white px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[12.5px] font-semibold text-[var(--color-text-1)]">{action.label}</p>
                  <span className="text-[10px] text-[var(--color-text-4)]">P{action.priority}</span>
                </div>
                <p className="mt-1 text-[11.5px] leading-5 text-[var(--color-text-3)]">{action.reason}</p>
              </div>
            ))}
          </AccountSection>

          <AccountSection title="Signal Timeline">
            {state.signals.length === 0 ? (
              <EmptyLine>No signals recorded.</EmptyLine>
            ) : state.signals.slice(0, 8).map(signal => (
              <TimelineItem key={signal.id} title={signal.headline} meta={`${signal.signal_type} · ${formatShortDate(signal.observed_at)}`} body={signal.summary ?? signal.source_name ?? 'Signal captured.'} />
            ))}
          </AccountSection>
        </div>

        <div className="space-y-5 p-5">
          <AccountSection title="Memory">
            {state.memories.length === 0 ? (
              <EmptyLine>No memory recorded.</EmptyLine>
            ) : state.memories.slice(0, 6).map(memory => (
              <TimelineItem key={memory.id} title={memory.memory_type.replace(/_/g, ' ')} meta={`${Math.round(memory.confidence * 100)}% · ${memory.source}`} body={memory.content} />
            ))}
          </AccountSection>

          <AccountSection title="People">
            {state.people.length === 0 ? (
              <EmptyLine>No people recorded.</EmptyLine>
            ) : state.people.slice(0, 6).map(person => (
              <div key={person.id} className="rounded-2xl border border-[var(--color-line-1)] bg-white px-3 py-3">
                <p className="truncate text-[12.5px] font-semibold text-[var(--color-text-1)]">{person.name ?? person.email ?? 'Unknown contact'}</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-4)]">{person.title ?? 'No title'}{person.verified ? ' · verified' : ''}</p>
              </div>
            ))}
          </AccountSection>
        </div>
      </div>
    </div>
  )
}

function AccountSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function TimelineItem({ title, meta, body }: { title: string; meta: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line-1)] bg-white px-3 py-3">
      <p className="line-clamp-1 text-[12.5px] font-semibold text-[var(--color-text-1)]">{title}</p>
      <p className="mt-0.5 text-[10.5px] text-[var(--color-text-4)]">{meta}</p>
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--color-text-3)]">{body}</p>
    </div>
  )
}

function SmallCount({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] ${accent ? 'bg-[var(--color-accent)] text-white' : 'bg-white text-[var(--color-text-4)]'}`}>
      {value} {label}
    </span>
  )
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const rounded = Math.round(value)
  const tone = rounded >= 70
    ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
    : rounded >= 45
      ? 'bg-[#fff4df] text-[#936014]'
      : 'bg-red-50 text-red-600'
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${tone}`}>
      {label} {rounded}
    </span>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-[var(--color-line-2)] px-4 py-6 text-center text-xs text-[var(--color-text-4)]">{children}</p>
}

function PanelError({ title, message }: { title: string; message: string }) {
  return (
    <section className="card px-5 py-5">
      <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
      <p className="mt-2 text-xs text-[var(--color-sig-regulation)]">{message}</p>
    </section>
  )
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function McpPanel() {
  const [origin] = useState(() => (
    typeof window === 'undefined' ? 'https://your-bombsell-domain.com' : window.location.origin
  ))
  const [copied, setCopied] = useState<string | null>(null)

  const endpoint = `${origin}/api/mcp`
  const codexCli = `codex mcp add bombsell --url ${endpoint}

codex mcp login bombsell \\
  --scopes bombsell:read,bombsell:write:safe`
  const claudeCli = `claude mcp add --transport http bombsell \\
  ${endpoint}`

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value)
    setCopied(key)
    window.setTimeout(() => setCopied(null), 1600)
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-[var(--color-line-1)] bg-white shadow-[0_20px_60px_-36px_#1d2b4f33]">
        <div className="relative px-6 py-6 sm:px-7">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_70%_20%,rgba(38,115,255,0.12),transparent_34%),linear-gradient(135deg,transparent,rgba(16,185,129,0.08))]" />
          <div className="relative max-w-2xl">
            <span className="inline-flex rounded-full border border-[var(--color-accent)]/20 bg-[var(--color-accent-bg)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent-ring)]">
              Agent-ready GTM context
            </span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--color-text-1)]">
              Bombsell for Codex and Claude.
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
              Connect Bombsell to Codex CLI or Claude Code so your coding agents can inspect GTM context, read account work, update safe workflow state, and add watched accounts. Setup uses browser OAuth.
            </p>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Setup From CLI</h3>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">
            Add Bombsell once, then approve access in the browser with your Bombsell account.
          </p>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <McpCodeBlock
            title="Codex CLI"
            description="Registers Bombsell as a remote Streamable HTTP MCP server."
            code={codexCli}
            copied={copied === 'codex'}
            onCopy={() => copy(codexCli, 'codex')}
          />
          <McpCodeBlock
            title="Claude Code"
            description="Registers Bombsell as a remote HTTP MCP server."
            code={claudeCli}
            copied={copied === 'claude'}
            onCopy={() => copy(claudeCli, 'claude')}
          />
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-[var(--color-line-1)] px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Available To Agents</h3>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Context', 'Workspace ICP and active client.'],
            ['Accounts', 'Live, batch, and CRM-sourced account context.'],
            ['Workflow', 'Safe lead status updates.'],
            ['Watchlist', 'Read and add watched companies.'],
            ['Sessions', 'Batch and CRM source sessions.'],
            ['Signals', 'Company signal timelines.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/45 p-4">
              <p className="text-[12.5px] font-semibold text-[var(--color-text-1)]">{title}</p>
              <p className="mt-1 text-[11.5px] leading-5 text-[var(--color-text-3)]">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function McpCodeBlock({
  title,
  description,
  code,
  copied,
  onCopy,
}: {
  title: string
  description: string
  code: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <section className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line-1)] px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h3>
          <p className="mt-1 text-xs text-[var(--color-text-4)]">{description}</p>
        </div>
        <button onClick={onCopy} className="rounded-full border border-[var(--color-line-2)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-1)]">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-x-auto bg-[var(--color-ink-2)] p-5 text-[11.5px] leading-5 text-[var(--color-text-1)]">
        <code>{code}</code>
      </pre>
    </section>
  )
}

const CREDIT_TOP_UPS = [
  { amount: 5, credits: 20 },
  { amount: 20, credits: 80 },
  { amount: 50, credits: 200 },
  { amount: 100, credits: 400 },
]

function AutomationPanel() {
  const [liveAutopilotOn, setLiveAutopilotOn] = useState(false)
  const [autoSendSaving, setAutoSendSaving] = useState(false)
  const [autoSendLoaded, setAutoSendLoaded] = useState(false)
  const [autoSendMsg, setAutoSendMsg] = useState<string | null>(null)
  const [autoSendAccounts, setAutoSendAccounts] = useState<AutoSendAccount[]>([])
  const [autoSendAccountId, setAutoSendAccountId] = useState<string | null>(null)
  const [autoSendRequireVerified, setAutoSendRequireVerified] = useState(true)
  const [autoSendMinScore, setAutoSendMinScore] = useState(7)
  const [autoSendMaxAge, setAutoSendMaxAge] = useState(30)
  const [dailySendLimit, setDailySendLimit] = useState(10)
  const [sendSpacing, setSendSpacing] = useState(15)
  const [followups, setFollowups] = useState<PendingFollowup[]>([])
  const [followupsLoaded, setFollowupsLoaded] = useState(false)
  const [cancellingFollowupId, setCancellingFollowupId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/auto-send', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as {
          error?: string
          policy?: {
            enabled?: boolean
            connected_account_id?: string | null
            target_origins?: Array<'live' | 'explore'>
            target_explore_session_ids?: string[]
            require_verified_contact?: boolean
            min_relevance_score?: number
            max_lead_age_days?: number
            daily_send_limit?: number
            min_minutes_between_sends?: number
          }
          accounts?: AutoSendAccount[]
        } | null
        if (cancelled || !data) return
        if (!res.ok) {
          setAutoSendMsg(data.error ?? 'Failed to load workflow settings.')
          setAutoSendLoaded(true)
          return
        }
        const origins = data.policy?.target_origins ?? []
        setLiveAutopilotOn(Boolean(data.policy?.enabled && origins.includes('live')))
        setAutoSendAccountId(data.policy?.connected_account_id ?? null)
        setAutoSendRequireVerified(data.policy?.require_verified_contact !== false)
        setAutoSendMinScore(data.policy?.min_relevance_score ?? 7)
        setAutoSendMaxAge(data.policy?.max_lead_age_days ?? 30)
        setDailySendLimit(data.policy?.daily_send_limit ?? 10)
        setSendSpacing(data.policy?.min_minutes_between_sends ?? 15)
        setAutoSendAccounts(data.accounts ?? [])
        setAutoSendLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setAutoSendMsg('Failed to load workflow settings.')
          setAutoSendLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/leads/pending-followups', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ followups?: PendingFollowup[] }>)
      .then(data => {
        if (cancelled) return
        setFollowups(data.followups ?? [])
        setFollowupsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setFollowupsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const cancelFollowup = useCallback(async (leadId: string, followupId: string) => {
    setCancellingFollowupId(followupId)
    try {
      await fetch(`/api/leads/${leadId}/followup`, { method: 'DELETE' })
      setFollowups(prev => prev.filter(followup => followup.id !== followupId))
    } finally {
      setCancellingFollowupId(null)
    }
  }, [])

  const saveAutoSend = useCallback(async () => {
    setAutoSendSaving(true)
    setAutoSendMsg(null)
    try {
      const res = await fetch('/api/settings/auto-send', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: liveAutopilotOn,
          connected_account_id: autoSendAccountId,
          target_origins: liveAutopilotOn ? ['live' as const] : [],
          target_explore_session_ids: [],
          require_verified_contact: autoSendRequireVerified,
          min_relevance_score: autoSendMinScore,
          max_lead_age_days: autoSendMaxAge,
          daily_send_limit: dailySendLimit,
          min_minutes_between_sends: sendSpacing,
        }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        setAutoSendMsg(data?.error ?? 'Failed to save workflow settings.')
        return
      }
      setAutoSendMsg('Workflow runtime saved')
    } catch {
      setAutoSendMsg('Failed to save workflow settings.')
    } finally {
      setAutoSendSaving(false)
    }
  }, [liveAutopilotOn, autoSendAccountId, autoSendRequireVerified, autoSendMinScore, autoSendMaxAge, dailySendLimit, sendSpacing])

  if (!autoSendLoaded || !followupsLoaded) {
    return <TabLoadingState title="Loading Workflow Runtime" detail="Fetching runtime policy, sending inboxes, safety controls, and scheduled follow-ups." />
  }

  return (
    <div className="w-full space-y-4">
      <div className="card divide-y divide-[var(--color-line-1)]">
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Live Workflow Runtime</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Configure live-signal execution, inbox rotation, caps, pacing, and contact safety.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${
              liveAutopilotOn
                ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
                : 'bg-[var(--color-ink-2)] text-[var(--color-text-4)]'
            }`}>
              {liveAutopilotOn ? 'On' : 'Off'}
            </span>
            <button
              role="switch"
              aria-checked={liveAutopilotOn}
              disabled={autoSendSaving || !autoSendLoaded}
              onClick={() => setLiveAutopilotOn(enabled => !enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none disabled:opacity-50 ${
                liveAutopilotOn ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'bg-[var(--color-ink-2)] border-[var(--color-line-2)]'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform mt-[-1px] ${liveAutopilotOn ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        <div className={`px-5 py-4 space-y-5 transition-all duration-200 ${
          liveAutopilotOn ? 'opacity-100 saturate-100' : 'opacity-60 saturate-75'
        }`}>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-[var(--color-text-1)]">Sending inbox</span>
              <select
                value={autoSendAccountId ?? ''}
                onChange={e => setAutoSendAccountId(e.target.value || null)}
                className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px] text-[var(--color-text-1)]"
              >
                <option value="">Least recently used active inbox</option>
                {autoSendAccounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {(account.display_name || account.email)} · {account.provider}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--color-text-1)]">Daily cap</span>
                <select value={dailySendLimit} onChange={e => setDailySendLimit(Number(e.target.value))} className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px]">
                  {[5, 10, 15, 20, 30, 50].map(value => <option key={value} value={value}>{value}/day</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--color-text-1)]">Send spacing</span>
                <select value={sendSpacing} onChange={e => setSendSpacing(Number(e.target.value))} className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px]">
                  {[15, 30, 60, 120, 240].map(value => <option key={value} value={value}>{value} min</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-text-1)]">Scope</p>
              <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-3">
                <p className="text-[12.5px] font-medium text-[var(--color-text-1)]">Live signal work</p>
                <p className="mt-0.5 text-[11px] leading-5 text-[var(--color-text-4)]">
                  Runs on eligible unlocked leads from active monitoring. Batch session selection is not part of this MVP runtime.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-text-1)]">Runtime order</p>
              <div className="grid grid-cols-2 gap-2">
                {['Monitor', 'Verify', 'Send', 'Stop on reply'].map(step => (
                  <div key={step} className="rounded-2xl border border-[var(--color-line-1)] bg-white px-3 py-3 text-[11.5px] font-medium text-[var(--color-text-2)]">
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-[var(--color-text-1)]">Min score</span>
              <select value={autoSendMinScore} onChange={e => setAutoSendMinScore(Number(e.target.value))} className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px]">
                {Array.from({ length: 10 }, (_, index) => index + 1).map(score => <option key={score} value={score}>{score}+</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-[var(--color-text-1)]">Max lead age</span>
              <select value={autoSendMaxAge} onChange={e => setAutoSendMaxAge(Number(e.target.value))} className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px]">
                {[7, 14, 30, 60, 90].map(days => <option key={days} value={days}>{days} days</option>)}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3">
              <span>
                <span className="block text-[12px] font-medium text-[var(--color-text-1)]">Verified only</span>
                <span className="block text-[10.5px] text-[var(--color-text-4)]">Always enforced by automation.</span>
              </span>
              <input type="checkbox" checked={autoSendRequireVerified} onChange={e => setAutoSendRequireVerified(e.target.checked)} />
            </label>
          </div>

          <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3 text-[11.5px] leading-5 text-[var(--color-text-3)]">
            Live workflows spend credits only on lead unlocks. Sending requires verified contacts, skips unsubscribed or bounced recipients, rotates inboxes when no specific inbox is selected, and enforces daily caps plus spacing.
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-[var(--color-text-4)]">{autoSendMsg ?? 'Turn on the runtime when inbox, credits, and ICP are ready.'}</div>
            <button onClick={saveAutoSend} disabled={autoSendSaving || !autoSendLoaded} className="inline-flex items-center gap-1.5 rounded-full btn-primary px-3 py-1.5 text-xs disabled:opacity-50">
              {autoSendSaving ? 'Saving…' : liveAutopilotOn ? 'Save live runtime' : 'Save runtime off'}
            </button>
          </div>
        </div>
        <PendingFollowupsPanel followups={followups} cancelling={cancellingFollowupId} onCancel={cancelFollowup} />
      </div>
    </div>
  )
}

function SettingsPanel({
  profile,
}: {
  profile: UserProfile
}) {
  const leadCreditBalance = profile.lead_credit_balance ?? 0

  const [slackUrl, setSlackUrl] = useState(profile.slack_webhook_url ?? '')
  const [slackMinScore, setSlackMinScore] = useState(profile.slack_min_score ?? 7)
  const [slackSaving, setSlackSaving] = useState(false)
  const [slackMsg, setSlackMsg] = useState<string | null>(null)
  const [selectedCreditTopUpIndex, setSelectedCreditTopUpIndex] = useState(1)
  const [creditCheckoutAmount, setCreditCheckoutAmount] = useState<number | null>(null)
  const [creditCheckoutMsg, setCreditCheckoutMsg] = useState<string | null>(null)
  const selectedCreditTopUp = CREDIT_TOP_UPS[selectedCreditTopUpIndex] ?? CREDIT_TOP_UPS[1]

  const saveSlack = useCallback(async () => {
    setSlackSaving(true)
    setSlackMsg(null)
    try {
      const res = await fetch('/api/settings/slack-webhook', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slack_webhook_url: slackUrl || null,
          slack_min_score: slackMinScore,
        }),
      })
      const data = await res.json() as { error?: string }
      setSlackMsg(data.error ? `Error: ${data.error}` : 'Saved')
    } catch {
      setSlackMsg('Failed to save')
    } finally {
      setSlackSaving(false)
    }
  }, [slackMinScore, slackUrl])

  const startCreditCheckout = useCallback(async (amountDollars: number) => {
    setCreditCheckoutAmount(amountDollars)
    setCreditCheckoutMsg(null)
    try {
      const res = await fetch('/api/billing/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_dollars: amountDollars }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (!res.ok || !data?.url) {
        setCreditCheckoutMsg(data?.error ?? 'Unable to start credit checkout.')
        return
      }
      window.location.assign(data.url)
    } catch {
      setCreditCheckoutMsg('Unable to start credit checkout.')
    } finally {
      setCreditCheckoutAmount(null)
    }
  }, [])

  return (
    <div className="w-full space-y-4">
      {/* Credits card */}
      <div className="card divide-y divide-[var(--color-line-1)]">
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Credits</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">All product features are available. Credits are used only when you unlock leads.</p>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-[var(--color-line-2)] bg-[var(--color-ink-2)] text-[var(--color-accent-ring)]">
            PAYG
          </span>
        </div>
        <div className="px-5 py-4 border-t border-[var(--color-line-1)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--color-text-1)]">Add lead credits</p>
              <p className="text-xs text-[var(--color-text-4)] mt-0.5">
                Every lead unlock costs 1 credit. New workspaces start with 20 credits. Each $1 adds 4 lead unlocks.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-[var(--color-line-2)] bg-[var(--color-ink-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent-ring)]">
              {leadCreditBalance} credits
            </span>
          </div>
          <div className="mt-4 rounded-2xl border border-[var(--color-line-1)] bg-white px-4 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Top up amount</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-text-1)]">
                  ${selectedCreditTopUp.amount}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Unlocks</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-accent-ring)]">
                  {selectedCreditTopUp.credits}
                </p>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={CREDIT_TOP_UPS.length - 1}
              step={1}
              value={selectedCreditTopUpIndex}
              onChange={event => setSelectedCreditTopUpIndex(Number(event.target.value))}
              className="mt-4 w-full accent-[var(--color-accent)]"
              aria-label="Credit top up amount"
            />
            <div className="mt-2 grid grid-cols-4 gap-2">
              {CREDIT_TOP_UPS.map((option, index) => (
                <button
                  key={option.amount}
                  type="button"
                  onClick={() => setSelectedCreditTopUpIndex(index)}
                  className={`rounded-xl border px-2 py-2 text-left transition-colors ${
                    selectedCreditTopUpIndex === index
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)]'
                      : 'border-[var(--color-line-1)] bg-white hover:border-[var(--color-accent)]/40'
                  }`}
                >
                  <span className="block text-[11.5px] font-semibold text-[var(--color-text-1)]">${option.amount}</span>
                  <span className="block text-[10.5px] text-[var(--color-text-4)]">{option.credits}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[11px] text-[var(--color-text-4)]">Checkout opens securely for the selected amount.</p>
              <button
                onClick={() => startCreditCheckout(selectedCreditTopUp.amount)}
                disabled={creditCheckoutAmount !== null}
                className="rounded-full btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {creditCheckoutAmount !== null ? 'Starting…' : 'Top Up'}
              </button>
            </div>
          </div>
          {creditCheckoutMsg && (
            <p className="mt-2 text-[11px] text-[var(--color-sig-regulation)]">{creditCheckoutMsg}</p>
          )}
        </div>
      </div>

      <ConnectedAccountsPanel />

      <ClientWorkspacePanel activeClientId={profile.active_client_id ?? null} />

      <CrmSyncPanel />

      <div className="card divide-y divide-[var(--color-line-1)]">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Watched Accounts</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">
            Companies that should stay in memory and bypass normal signal filtering.
          </p>
        </div>
        <div className="px-5 py-4">
          <WatchlistManager />
        </div>
      </div>

      {/* Targeting */}
      <div className="card divide-y divide-[var(--color-line-1)]">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Targeting</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">
            These values drive which signals Bombsell surfaces for you.
          </p>
        </div>
        <div className="divide-y divide-[var(--color-line-1)]">
          <Row label="Company">{profile.company_name || '—'}</Row>
          <Row label="Workspace">{profile.client_name || profile.company_name || '—'}</Row>
          <Row label="Website">{profile.website_url || '—'}</Row>
          <Row label="What you sell">
            <span className="text-[var(--color-text-2)] leading-relaxed">{profile.services_description || '—'}</span>
          </Row>
          <Row label="ICP keywords">
            <div className="flex flex-wrap gap-1.5">
              {(profile.icp_keywords ?? []).length === 0 ? (
                <span className="text-[var(--color-text-4)]">—</span>
              ) : (
                (profile.icp_keywords ?? []).map(k => (
                  <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-ink-2)] border border-[var(--color-line-1)] text-[var(--color-text-2)]">
                    {k}
                  </span>
                ))
              )}
            </div>
          </Row>
        </div>
        <div className="px-5 py-4">
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-primary transition-colors"
          >
            Edit targeting
          </Link>
        </div>
      </div>

      <div className="card divide-y divide-[var(--color-line-1)]">
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Slack Alerts</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Get notified in Slack when a signal reaches your selected relevance score.
            </p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px]">
              <input
                type="url"
                placeholder="https://hooks.slack.com/services/..."
                value={slackUrl}
                onChange={e => setSlackUrl(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
              <label className="space-y-1">
                <span className="sr-only">Slack alert threshold</span>
                <select
                  value={slackMinScore}
                  onChange={e => setSlackMinScore(Number(e.target.value))}
                  className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px] text-[var(--color-text-1)]"
                >
                  {Array.from({ length: 10 }, (_, index) => index + 1).map(score => (
                    <option key={score} value={score}>Score {score}+</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-[11px] text-[var(--color-text-4)]">
              Slack alerts will send for live signal-feed leads with relevance score {slackMinScore}+.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={saveSlack}
                disabled={slackSaving}
                className="inline-flex items-center text-xs font-medium px-3.5 py-1.5 rounded-full btn-primary disabled:opacity-50"
              >
                {slackSaving ? 'Saving…' : 'Save'}
              </button>
              {slackMsg && (
                <span className={`text-xs ${slackMsg.startsWith('Error') ? 'text-[var(--color-sig-regulation)]' : 'text-[var(--color-sig-funding)]'}`}>
                  {slackMsg}
                </span>
              )}
            </div>
          </div>
      </div>

      <SequenceTemplatesPanel />

      {/* Blocked companies */}
      <BlockedCompaniesPanel />
    </div>
  )
}

function StatusPill({
  active,
  activeLabel,
  idleLabel,
}: {
  active: boolean
  activeLabel: string
  idleLabel: string
}) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] ${
      active
        ? 'border-[var(--color-accent)]/25 bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
        : 'border-[var(--color-line-1)] bg-[var(--color-ink-2)] text-[var(--color-text-3)]'
    }`}>
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-4)]/60'}`} />
      <span>{active ? activeLabel : idleLabel}</span>
    </div>
  )
}

interface ClientAccountSummary {
  id: string
  name: string
}

function ClientWorkspacePanel({ activeClientId }: { activeClientId: string | null }) {
  const [clients, setClients] = useState<ClientAccountSummary[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/clients')
      const data = await res.json() as { clients?: ClientAccountSummary[] }
      setClients(data.clients ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createClient() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (res.ok) window.location.reload()
      else setError(data?.error ?? 'Failed to create client workspace')
    } finally {
      setSaving(false)
    }
  }

  async function switchClient(id: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeClientId: id }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (res.ok) window.location.reload()
      else setError(data?.error ?? 'Failed to switch client workspace')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card divide-y divide-[var(--color-line-1)]">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Clients</h2>
        <p className="text-xs text-[var(--color-text-4)] mt-0.5">
          Keep separate targeting and lead feeds for each client or business line.
        </p>
      </div>
      <div className="px-5 py-4 space-y-3">
        {loading ? (
          <p className="text-xs text-[var(--color-text-4)]">Loading clients…</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {clients.map(client => (
              <button
                key={client.id}
                onClick={() => switchClient(client.id)}
                disabled={saving || client.id === activeClientId}
                className={`px-3 py-1.5 rounded-full text-xs border ${
                  client.id === activeClientId
                    ? 'bg-[var(--color-accent-bg)] border-[var(--color-accent)]/30 text-[var(--color-accent-ring)]'
                    : 'bg-white border-[var(--color-line-1)] text-[var(--color-text-2)] hover:text-[var(--color-text-1)]'
                } disabled:opacity-70`}
              >
                {client.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Add a client workspace"
            className="flex-1 h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px]"
          />
          <button
            onClick={createClient}
            disabled={saving || !name.trim()}
            className="px-3.5 rounded-full btn-primary text-xs disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error && <p className="text-[11px] text-[var(--color-sig-regulation)]">{error}</p>}
      </div>
    </div>
  )
}

interface SequenceTemplateRow {
  id: string
  name: string
  custom_instructions: string | null
  followup_custom_instructions: string | null
  is_default: boolean
}

function SequenceTemplatesPanel() {
  const [templates, setTemplates] = useState<SequenceTemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('Default')
  const [instructions, setInstructions] = useState('')
  const [followupInstructions, setFollowupInstructions] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sequence-templates')
      const data = await res.json() as { templates?: SequenceTemplateRow[] }
      setTemplates(data.templates ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveTemplate() {
    setSaving(true)
    try {
      const res = await fetch('/api/sequence-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          custom_instructions: instructions,
          followup_custom_instructions: followupInstructions,
          is_default: true,
        }),
      })
      if (res.ok) {
        setInstructions('')
        setFollowupInstructions('')
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function makeDefault(id: string) {
    setSaving(true)
    try {
      await fetch('/api/sequence-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_default: true }),
      })
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card divide-y divide-[var(--color-line-1)]">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Sequence Templates</h2>
        <p className="text-xs text-[var(--color-text-4)] mt-0.5">
          Reusable guidance injected into draft generation for this client.
        </p>
      </div>
      <div className="px-5 py-4 space-y-3">
        <input value={name} onChange={e => setName(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px]" placeholder="Template name" />
        <textarea value={instructions} onChange={e => setInstructions(e.target.value)} className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px]" placeholder="Initial email guidance, tone, CTA, positioning…" />
        <textarea value={followupInstructions} onChange={e => setFollowupInstructions(e.target.value)} className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px]" placeholder="Follow-up guidance, objection handling, CTA…" />
        <button onClick={saveTemplate} disabled={saving || !name.trim()} className="px-3.5 py-2 rounded-full btn-primary text-xs disabled:opacity-50">
          Save as default
        </button>
        {loading ? (
          <p className="text-xs text-[var(--color-text-4)]">Loading templates…</p>
        ) : (
          <div className="space-y-2">
            {templates.map(template => (
              <div key={template.id} className="rounded-lg border border-[var(--color-line-1)] bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--color-text-1)]">{template.name}</p>
                    <p className="text-[11px] text-[var(--color-text-4)]">{template.is_default ? 'Default template' : 'Saved template'}</p>
                  </div>
                  {!template.is_default && (
                    <button onClick={() => makeDefault(template.id)} className="text-[11px] text-[var(--color-accent-ring)]">
                      Make default
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CrmSyncPanel() {
  const [provider, setProvider] = useState('webhook')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [isEditing, setIsEditing] = useState(true)
  const [savedConfig, setSavedConfig] = useState<{
    provider: string
    webhookUrl: string
    enabled: boolean
  } | null>(null)
  const [providers, setProviders] = useState<Array<{
    id: string
    label: string
    export_url: string
    exportDescription: string
    importDescription: string
    exportFields: Array<{ ourField: string; crmField: string }>
    importFields: Array<{ ourField: string; crmField: string; required?: boolean }>
  }>>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showMapping, setShowMapping] = useState(false)

  useEffect(() => {
    fetch('/api/settings/crm-sync')
      .then(r => r.json() as Promise<{
        provider?: string
        webhook_url?: string
        enabled?: boolean
        providers?: Array<{
          id: string
          label: string
          export_url: string
          exportDescription: string
          importDescription: string
          exportFields: Array<{ ourField: string; crmField: string }>
          importFields: Array<{ ourField: string; crmField: string; required?: boolean }>
        }>
      }>)
      .then(data => {
        const nextConfig = {
          provider: data.provider ?? 'webhook',
          webhookUrl: data.webhook_url ?? '',
          enabled: Boolean(data.enabled),
        }
        setProvider(nextConfig.provider)
        setWebhookUrl(nextConfig.webhookUrl)
        setEnabled(nextConfig.enabled)
        setSavedConfig(nextConfig)
        setIsEditing(!hasCrmConnection(nextConfig))
        setProviders(data.providers ?? [])
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const selectedProvider = providers.find(item => item.id === provider) ?? providers[0] ?? null

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/crm-sync', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          webhook_url: webhookUrl,
          enabled,
        }),
      })
      const data = await res.json() as {
        error?: string
        provider?: string
        webhook_url?: string
        enabled?: boolean
      }
      if (!res.ok || data.error) {
        setMessage(data.error ?? 'Failed to save CRM sync')
        return
      }
      const nextConfig = {
        provider: data.provider ?? provider,
        webhookUrl: data.webhook_url ?? webhookUrl,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : enabled,
      }
      setProvider(nextConfig.provider)
      setWebhookUrl(nextConfig.webhookUrl)
      setEnabled(nextConfig.enabled)
      setSavedConfig(nextConfig)
      setMessage('CRM connection saved')
      if (hasCrmConnection(nextConfig)) setIsEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const isConnected = savedConfig ? hasCrmConnection(savedConfig) : false
  const outboundDestination = savedConfig?.webhookUrl ? summarizeUrl(savedConfig.webhookUrl) : 'Not configured'
  const providerLabel = selectedProvider?.label ?? provider

  return (
    <div className="card divide-y divide-[var(--color-line-1)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">CRM Export</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">
            Optional destination for approved account outcomes. The live runtime works without a CRM connection.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill active={enabled} activeLabel="Export connected" idleLabel="Export off" />
          {isConnected && !isEditing && (
            <button
              onClick={() => {
                setMessage(null)
                setIsEditing(true)
              }}
              className="rounded-full btn-primary px-3 py-1.5 text-[11px] font-medium"
            >
              Edit
            </button>
          )}
        </div>
      </div>
      <div className="px-5 py-3 space-y-3">
        {!isEditing && isConnected ? (
          <div className="grid gap-3">
            <CrmWorkflowSummary
              eyebrow="Export workflow"
              title="Approved records to CRM"
              status={savedConfig?.enabled ? 'Connected' : 'Off'}
              body={`Approved records can be pushed to ${providerLabel} via ${outboundDestination}. Keep this as a downstream handoff, not a required runtime step.`}
            />
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              <div className="rounded-2xl border border-[var(--color-line-1)] bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Connection</p>
                <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Outbound export endpoint</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-3)]">
                  Bombsell POSTs approved records to this endpoint. Imports and bidirectional CRM sync stay outside the MVP runtime.
                </p>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  placeholder="Outbound CRM webhook URL"
                  className="mt-3 w-full h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px]"
                />
                <label className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-2)]">
                  <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                  Enable CRM export
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--color-text-3)]">
                <span>Provider</span>
                <select
                  aria-label="CRM provider"
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  className="h-9 min-w-36 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] text-[var(--color-text-1)]"
                >
                  {providers.map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <button onClick={save} disabled={!loaded || saving} className="h-9 whitespace-nowrap rounded-full btn-primary px-3.5 text-xs disabled:opacity-50">
                {saving ? 'Saving…' : isConnected ? 'Update export' : 'Save export'}
              </button>
              {isConnected && (
                <button
                  onClick={() => {
                    if (!savedConfig) return
                    setProvider(savedConfig.provider)
                    setWebhookUrl(savedConfig.webhookUrl)
                    setEnabled(savedConfig.enabled)
                    setMessage(null)
                    setIsEditing(false)
                  }}
                  className="h-9 rounded-full border border-[var(--color-line-2)] bg-white px-3.5 text-xs font-medium text-[var(--color-text-2)]"
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            onClick={() => setShowMapping(value => !value)}
            className="text-[11px] font-medium text-[var(--color-text-3)] hover:text-[var(--color-text-1)]"
          >
            {showMapping ? 'Hide mapping' : 'Show mapping'}
          </button>
        </div>

        {selectedProvider && showMapping && (
          <div className="rounded-xl border border-[var(--color-line-1)] bg-white px-3 py-3 space-y-3">
            <div>
              <p className="text-xs font-medium text-[var(--color-text-1)]">{selectedProvider.label} mapping</p>
              <p className="text-[11px] text-[var(--color-text-4)] mt-0.5">{selectedProvider.exportDescription}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-4)] mb-2">Export fields</p>
              <div className="space-y-1.5">
                {selectedProvider.exportFields.map(field => (
                  <div key={`${field.ourField}-${field.crmField}`} className="flex items-start justify-between gap-3 text-[11px]">
                    <span className="text-[var(--color-text-2)]">{field.ourField}</span>
                    <span className="text-[var(--color-text-4)] text-right">{field.crmField}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-[var(--color-text-4)]">
              CRM export is a downstream handoff for approved records, not a dependency for live monitoring or sending.
            </p>
          </div>
        )}
        {message && <p className="text-[11px] text-[var(--color-text-4)]">{message}</p>}
      </div>
    </div>
  )
}

function hasCrmConnection(config: {
  webhookUrl: string
  enabled: boolean
}) {
  return config.enabled && Boolean(config.webhookUrl)
}

function summarizeUrl(value: string): string {
  try {
    const url = new URL(value)
    return url.hostname
  } catch {
    return value || 'Not configured'
  }
}

function CrmWorkflowSummary({
  eyebrow,
  title,
  status,
  body,
}: {
  eyebrow: string
  title: string
  status: string
  body: string
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-line-1)] bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">{eyebrow}</p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">{title}</h3>
        </div>
        <span className="rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-2.5 py-1 text-[10px] font-medium text-[var(--color-text-3)]">
          {status}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-3)]">{body}</p>
    </div>
  )
}

function LogoutButton() {
  const [loading, setLoading] = useState(false)

  async function logout() {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return (
    <button
      onClick={logout}
      disabled={loading}
      className="h-9 w-9 inline-flex items-center justify-center rounded-full text-[var(--color-text-2)] hover:text-[var(--color-sig-regulation)] hover:bg-[var(--color-ink-2)] disabled:opacity-50 transition-colors"
      title="Sign out"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    </button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 px-5 py-3 text-xs">
      <dt className="text-[10px] uppercase tracking-widest text-[var(--color-text-4)] pt-0.5 font-medium">{label}</dt>
      <dd className="text-[var(--color-text-1)]">{children}</dd>
    </div>
  )
}

interface PendingFollowup {
  id: string
  scheduled_for: string
  lead_id: string
  leads: { id: string; target_company: string; status: string } | null
}

function PendingFollowupsPanel({
  followups,
  cancelling,
  onCancel,
}: {
  followups: PendingFollowup[]
  cancelling: string | null
  onCancel: (leadId: string, followupId: string) => void
}) {
  if (followups.length === 0) return null

  return (
    <>
      <div className="px-5 py-3">
        <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-4)] font-medium">
          Scheduled · {followups.length}
        </p>
      </div>
      <ul className="divide-y divide-[var(--color-line-1)]">
        {followups.map(f => (
          <li key={f.id} className="px-5 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-[var(--color-text-1)] truncate">{f.leads?.target_company ?? 'Unknown'}</p>
              <p className="text-[10px] text-[var(--color-text-4)] mt-0.5">
                {new Date(f.scheduled_for).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                })}
              </p>
            </div>
            <button
              onClick={() => f.leads && onCancel(f.leads.id, f.id)}
              disabled={cancelling === f.id}
              className="text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-sig-regulation)] disabled:opacity-50 transition-colors shrink-0"
            >
              {cancelling === f.id ? 'Cancelling…' : 'Cancel'}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

interface ConnectedAccount {
  id:           string
  provider:     'gmail' | 'outlook'
  email:        string
  display_name: string | null
  is_active:    boolean
  last_used_at: string | null
  created_at:   string
}

const PROVIDER_LABEL: Record<string, string> = { gmail: 'Gmail', outlook: 'Outlook' }
const ENABLE_GMAIL_CONNECT = process.env.NEXT_PUBLIC_ENABLE_GMAIL_CONNECT === 'true'

function ConnectedAccountsPanel() {
  const [accounts,    setAccounts]    = useState<ConnectedAccount[]>([])
  const [loaded,      setLoaded]      = useState(false)
  const [removing,    setRemoving]    = useState<string | null>(null)
  const [banner,      setBanner]      = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeAccounts = accounts.filter(account => account.is_active)
  const accountLimitReached = activeAccounts.length >= MAX_CONNECTED_SENDING_ACCOUNTS

  useEffect(() => {
    fetch('/api/connected-accounts', { cache: 'no-store' })
      .then(r => r.json() as Promise<{ accounts?: ConnectedAccount[]; max_accounts?: number }>)
      .then(d => { setAccounts(d.accounts ?? []); setLoaded(true) })
      .catch(() => setLoaded(true))

    // Read OAuth result from URL params
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('ca_connected')
    const error     = params.get('ca_error')
    if (connected) {
      showBanner('ok', `${PROVIDER_LABEL[connected] ?? connected} connected successfully.`)
    } else if (error) {
      const msgs: Record<string, string> = {
        google_denied:    'Google sign-in was cancelled.',
        gmail_disabled:   'Gmail connection is temporarily disabled while Google verification is completed.',
        microsoft_denied: 'Microsoft sign-in was cancelled.',
        google_failed:    'Google connection failed — please try again.',
        microsoft_failed: 'Microsoft connection failed — please try again.',
        invalid_state:    'Invalid OAuth state — please try again.',
        plan_required:    'Sending account connections are available on every workspace. Please try again.',
        max_accounts:     `You can connect up to ${MAX_CONNECTED_SENDING_ACCOUNTS} sending inboxes.`,
      }
      showBanner('err', msgs[error] ?? 'Connection failed.')
    }
  }, [])

  function showBanner(type: 'ok' | 'err', msg: string) {
    setBanner({ type, msg })
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 5000)
  }

  const remove = useCallback(async (id: string) => {
    setRemoving(id)
    try {
      await fetch('/api/connected-accounts', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      })
      setAccounts(prev => prev.filter(a => a.id !== id))
    } finally {
      setRemoving(null)
    }
  }, [])

  return (
    <div className="card divide-y divide-[var(--color-line-1)]">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Sending Accounts</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Emails send from your own inbox. Multiple accounts rotate automatically.
            </p>
          </div>
          <span className="shrink-0 rounded border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-3)]">
            {activeAccounts.length}/{MAX_CONNECTED_SENDING_ACCOUNTS}
          </span>
        </div>
      </div>

      {banner && (
        <div className={`px-5 py-2.5 text-xs ${
          banner.type === 'ok'
            ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
            : 'bg-red-50 text-red-600'
        }`}>
          {banner.msg}
        </div>
      )}

      {loaded && accounts.length > 0 && (
        <ul className="divide-y divide-[var(--color-line-1)]">
          {accounts.map(a => (
            <li key={a.id} className="px-5 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--color-ink-2)] border border-[var(--color-line-1)] text-[var(--color-text-3)]">
                    {PROVIDER_LABEL[a.provider]}
                  </span>
                  <span className="text-xs text-[var(--color-text-1)] truncate">
                    {a.display_name ? `${a.display_name} · ${a.email}` : a.email}
                  </span>
                </div>
                <p className="text-[10px] text-[var(--color-text-4)] mt-0.5">
                  {a.is_active ? 'Active' : 'Inactive'}
                  {a.last_used_at
                    ? ` · Last used ${new Date(a.last_used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : ' · Not used yet'}
                </p>
              </div>
              <button
                onClick={() => remove(a.id)}
                disabled={removing === a.id}
                className="text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-sig-regulation)] disabled:opacity-50 transition-colors shrink-0"
              >
                {removing === a.id ? 'Removing…' : 'Disconnect'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {loaded && accounts.length === 0 && (
        <div className="px-5 py-4 text-xs text-[var(--color-text-4)]">
          No sending inboxes connected.
        </div>
      )}

      <div className="px-5 py-4 flex items-center gap-2 flex-wrap">
        {accountLimitReached && (
          <span className="text-[11px] text-[var(--color-text-4)]">
            Disconnect an inbox before adding another.
          </span>
        )}
        {ENABLE_GMAIL_CONNECT && !accountLimitReached && (
          <a
            href="/api/auth/google-mail"
            className="inline-flex items-center gap-2 text-xs font-medium px-3.5 py-1.5 rounded-full btn-ghost transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Connect Gmail
          </a>
        )}
        {!accountLimitReached && (
          <a
            href="/api/auth/microsoft-mail"
            className="inline-flex items-center gap-2 text-xs font-medium px-3.5 py-1.5 rounded-full btn-ghost transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden>
              <path fill="#F25022" d="M1 1h10v10H1z"/>
              <path fill="#7FBA00" d="M13 1h10v10H13z"/>
              <path fill="#00A4EF" d="M1 13h10v10H1z"/>
              <path fill="#FFB900" d="M13 13h10v10H13z"/>
            </svg>
            Connect Outlook
          </a>
        )}
      </div>
    </div>
  )
}

interface BlockedCompany {
  id: string
  company_name: string
  company_domain: string | null
}

function BlockedCompaniesPanel() {
  const [blocked, setBlocked] = useState<BlockedCompany[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/blocked-companies')
      const data = await res.json() as { blocked?: BlockedCompany[] }
      setBlocked(data.blocked ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  const unblock = useCallback(async (id: string) => {
    await fetch(`/api/blocked-companies/${id}`, { method: 'DELETE' })
    setBlocked(prev => prev?.filter(b => b.id !== id) ?? [])
  }, [])

  return (
    <div className="rounded-lg border border-[var(--color-line-1)] bg-white divide-y divide-[var(--color-line-1)]">
      <div className="px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Blocked Companies</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">
            No signals from these companies will appear in your feed.
          </p>
        </div>
        {blocked === null && (
          <button
            onClick={load}
            disabled={loading}
            className="text-xs text-[var(--color-text-3)] hover:text-[var(--color-text-1)] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading…' : 'Show'}
          </button>
        )}
      </div>

      {blocked !== null && (
        blocked.length === 0 ? (
          <div className="px-5 py-4">
            <p className="text-xs text-[var(--color-text-4)]">No companies blocked.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)]">
            {blocked.map(b => (
              <li key={b.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-[var(--color-text-1)]">{b.company_name}</span>
                  {b.company_domain && (
                    <span className="ml-2 text-[10px] text-[var(--color-text-4)]">{b.company_domain}</span>
                  )}
                </div>
                <button
                  onClick={() => unblock(b.id)}
                  className="text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-sig-regulation)] transition-colors shrink-0"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
