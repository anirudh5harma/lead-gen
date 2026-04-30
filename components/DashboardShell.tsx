'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Sidebar from './Sidebar'
import LeadFeed, { type Lead } from './LeadFeed'
import WatchlistManager from './WatchlistManager'

type View = 'command' | 'feed' | 'explore' | 'crm' | 'automation' | 'mcp' | 'watchlist' | 'settings'

interface WatchlistItem {
  id: string
  company_name: string
  company_domain: string | null
}

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
  userId: string
  userProfile: UserProfile
  watchlist: WatchlistItem[]
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

interface AutoSendAccount {
  id: string
  provider: 'gmail' | 'outlook'
  email: string
  display_name?: string | null
}

const EXPLORE_PROGRESS_STEPS = [
  'Sending your targeting brief.',
  'Generating target accounts from your brief.',
  'Shaping lead records for the explore feed.',
  'Finalizing and saving results.',
]

const VIEW_TITLES: Record<View, string> = {
  command:   'Live Autopilot',
  feed:      'Signal Feed',
  explore:   'Explore',
  crm:       'CRM',
  automation: 'Automated Feeds',
  mcp:       'MCP',
  watchlist: 'Watchlist',
  settings:  'Settings',
}

export default function DashboardShell({ initialLeads, initialAgentEvents, userId, userProfile, watchlist }: Props) {
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const requestedView = params.get('view')
      if (requestedView === 'command' || requestedView === 'feed' || requestedView === 'explore' || requestedView === 'crm' || requestedView === 'automation' || requestedView === 'mcp' || requestedView === 'watchlist' || requestedView === 'settings') {
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
                {activeView === 'command' && 'Live signal automation, outcomes, replies, and booked meetings'}
                {activeView === 'feed' && 'Real-time buying signals scored against your ICP'}
                {activeView === 'explore' && 'Prompt-driven lead discovery based on who you want to target next'}
                {activeView === 'crm' && 'Stage leads from Signal and Explore, then push them to your configured CRM'}
                {activeView === 'automation' && 'Automate selected Explore sessions using your connected inboxes'}
                {activeView === 'mcp' && 'Let agent frameworks consume your GTM context and lead workflows'}
                {activeView === 'watchlist' && 'Companies you follow bypass relevance filtering'}
                {activeView === 'settings' && 'Billing, inbox connections, targeting, Slack alerts, templates, and blocked companies'}
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
            {activeView === 'feed' && (
              <div className="hidden lg:flex items-center gap-2 ml-6">
                <MetricChip value={metrics.signals} label="Signals" />
                <MetricChip value={metrics.drafted} label="Drafted" />
                <MetricChip value={metrics.sent}    label="Sent" />
                <MetricChip value={metrics.booked}  label="Booked" accent />
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
              {(activeView === 'feed' || activeView === 'command') && (
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
            {activeView === 'feed' && (
              <div className="space-y-4">
                <LeadFeed
                  initialLeads={initialLeads}
                  userId={userId}
                  watchlist={watchlist}
                  activeClientId={userProfile.active_client_id ?? null}
                  plan="free"
                  origin="live"
                  exportFeed="signal"
                  onOpenCrmTab={() => setActiveView('crm')}
                  onLeadCreditConsumed={() => setLeadCreditBalance(balance => Math.max(0, balance - 1))}
                />
              </div>
            )}
            {activeView === 'explore' && (
              <ExplorePanel
                initialLeads={initialLeads}
                userId={userId}
                watchlist={watchlist}
                activeClientId={userProfile.active_client_id ?? null}
                plan="free"
                onOpenCrmTab={() => setActiveView('crm')}
              />
            )}
            {activeView === 'crm' && (
              <CrmWorkspacePanel
                initialLeads={initialLeads}
                userId={userId}
                watchlist={watchlist}
                activeClientId={userProfile.active_client_id ?? null}
                plan="free"
              />
            )}
            {activeView === 'automation' && (
              <AutomationPanel />
            )}
            {activeView === 'mcp' && (
              <McpPanel />
            )}
            {activeView === 'watchlist' && (
              <div className="space-y-4">
                <p className="text-[12.5px] text-[var(--color-text-3)]">
                  Any signal from a watched company bypasses the relevance filter.
                </p>
                <WatchlistManager />
              </div>
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
  const [autopilotBusy, setAutopilotBusy] = useState(false)
  const [autopilotMessage, setAutopilotMessage] = useState<string | null>(null)
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
  const activeEvents = events.slice(0, 12)
  const sentToday = sent.filter(lead => lead.sent_at && lead.sent_at.slice(0, 10) === todayKey).length
  const replyRate = sent.length > 0 ? Math.round((replies.length / sent.length) * 100) : 0

  useEffect(() => {
    let cancelled = false
    fetch('/api/autopilot', { cache: 'no-store' })
      .then(res => res.json() as Promise<AutopilotStatus>)
      .then(data => { if (!cancelled) setAutopilot(data) })
      .catch(() => { if (!cancelled) setAutopilotMessage('Unable to load autopilot status.') })
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
      setAutopilotMessage(mode === 'autopilot' ? 'Live autopilot is on. Bombsell will run safely in the background.' : 'Live autopilot paused. Explore automation can still run if configured.')
    } catch {
      setAutopilotMessage('Unable to start autopilot.')
    } finally {
      setAutopilotBusy(false)
    }
  }, [])

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
        <OutcomeCard label="Needs approval" value={approvals.length} detail="Drafts or ready leads" tone="approval" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
        <section className="card overflow-hidden">
          <div className="border-b border-[var(--color-line-1)] px-5 py-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Revenue Inbox</h3>
          </div>
          <div className="grid divide-y divide-[var(--color-line-1)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <OutcomeList title="Needs Approval" empty="No leads waiting for approval." leads={approvals.slice(0, 6)} badge="Review" />
            <OutcomeList title="Replies" empty="No replies yet." leads={replies.slice(0, 6)} badge="Reply" showReplyIntent />
          </div>
          <div className="grid divide-y divide-[var(--color-line-1)] border-t border-[var(--color-line-1)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <OutcomeList title="Outbox" empty="No sent emails yet." leads={sent.slice(0, 6)} badge="Sent" />
            <OutcomeList title="Booked" empty="No booked meetings yet." leads={booked.slice(0, 6)} badge="Booked" showReplyIntent />
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--color-line-1)] px-5 py-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Agent Activity</h3>
          </div>
          {activeEvents.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm font-medium text-[var(--color-text-1)]">No agent events yet</p>
            </div>
          ) : (
            <div className="max-h-[620px] divide-y divide-[var(--color-line-1)] overflow-y-auto">
              {activeEvents.map(event => (
                <AgentEventRow key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="text-[11px] text-[var(--color-text-4)]">
        {recentLeads.length} recent live accounts monitored. Safety checks enforce verified contacts, unsubscribes, bounce suppression, caps, and pacing.
      </p>
    </div>
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
                {mode === 'autopilot' ? 'Running live signals' : 'Paused'}
              </h2>
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

function OutcomeList({
  title,
  empty,
  leads,
  badge,
  showReplyIntent = false,
}: {
  title: string
  empty: string
  leads: Lead[]
  badge: string
  showReplyIntent?: boolean
}) {
  return (
    <div className="min-h-[260px] px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">{title}</h4>
        <span className="rounded-full border border-[var(--color-line-1)] bg-white px-2 py-0.5 text-[10px] text-[var(--color-text-3)]">
          {leads.length}
        </span>
      </div>
      {leads.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-line-2)] px-4 py-6 text-center text-xs text-[var(--color-text-4)]">{empty}</p>
      ) : (
        <div className="space-y-2">
          {leads.map(lead => (
            <div key={`${title}-${lead.id}`} className="rounded-2xl border border-[var(--color-line-1)] bg-white px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold text-[var(--color-text-1)]">{lead.target_company}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-4)]">
                    {showReplyIntent && lead.reply_summary
                      ? lead.reply_summary
                      : lead.contact_email || lead.relevance_reason || 'No contact yet'}
                  </p>
                  {showReplyIntent && lead.reply_intent && (
                    <p className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-[var(--color-accent-ring)]">
                      {lead.reply_intent.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-3)]">{badge}</span>
              </div>
            </div>
          ))}
        </div>
      )}
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
              Connect Bombsell to Codex CLI or Claude Code so your coding agents can inspect GTM context, review leads, update safe workflow state, and add watchlist companies. Setup uses browser OAuth, so users approve access without copying API tokens.
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
            ['Leads', 'Live, Explore, and CRM-queued leads.'],
            ['Workflow', 'Safe lead status updates.'],
            ['Watchlist', 'Read and add watched companies.'],
            ['Sessions', 'Explore and CRM feed sessions.'],
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
interface ExploreAutomationSession {
  id: string
  label: string
  started_at: string
  lead_count: number
}

function AutomationPanel() {
  const [autoSend, setAutoSend] = useState(false)
  const [liveAutopilotOn, setLiveAutopilotOn] = useState(false)
  const [autoSendSaving, setAutoSendSaving] = useState(false)
  const [autoSendLoaded, setAutoSendLoaded] = useState(false)
  const [autoSendMsg, setAutoSendMsg] = useState<string | null>(null)
  const [autoSendAccounts, setAutoSendAccounts] = useState<AutoSendAccount[]>([])
  const [autoSendAccountId, setAutoSendAccountId] = useState<string | null>(null)
  const [selectedExploreSessions, setSelectedExploreSessions] = useState<string[]>([])
  const [exploreSessions, setExploreSessions] = useState<ExploreAutomationSession[]>([])
  const [autoSendRequireVerified, setAutoSendRequireVerified] = useState(true)
  const [autoSendMinScore, setAutoSendMinScore] = useState(7)
  const [autoSendMaxAge, setAutoSendMaxAge] = useState(30)
  const [dailySendLimit, setDailySendLimit] = useState(10)
  const [sendSpacing, setSendSpacing] = useState(15)

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
          explore_sessions?: ExploreAutomationSession[]
        } | null
        if (cancelled || !data) return
        if (!res.ok) {
          setAutoSendMsg(data.error ?? 'Failed to load feed automation settings.')
          setAutoSendLoaded(true)
          return
        }
        const origins = data.policy?.target_origins ?? []
        setLiveAutopilotOn(Boolean(data.policy?.enabled && origins.includes('live')))
        setAutoSend(Boolean(data.policy?.enabled && origins.includes('explore')))
        setAutoSendAccountId(data.policy?.connected_account_id ?? null)
        setSelectedExploreSessions(data.policy?.target_explore_session_ids ?? [])
        setAutoSendRequireVerified(data.policy?.require_verified_contact !== false)
        setAutoSendMinScore(data.policy?.min_relevance_score ?? 7)
        setAutoSendMaxAge(data.policy?.max_lead_age_days ?? 30)
        setDailySendLimit(data.policy?.daily_send_limit ?? 10)
        setSendSpacing(data.policy?.min_minutes_between_sends ?? 15)
        setAutoSendAccounts(data.accounts ?? [])
        setExploreSessions(data.explore_sessions ?? [])
        setAutoSendLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setAutoSendMsg('Failed to load feed automation settings.')
          setAutoSendLoaded(true)
        }
      })

    return () => {
      cancelled = true
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
          enabled: liveAutopilotOn || autoSend,
          connected_account_id: autoSendAccountId,
          target_origins: [
            ...(liveAutopilotOn ? ['live' as const] : []),
            ...(autoSend ? ['explore' as const] : []),
          ],
          target_explore_session_ids: selectedExploreSessions,
          require_verified_contact: autoSendRequireVerified,
          min_relevance_score: autoSendMinScore,
          max_lead_age_days: autoSendMaxAge,
          daily_send_limit: dailySendLimit,
          min_minutes_between_sends: sendSpacing,
        }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        setAutoSendMsg(data?.error ?? 'Failed to save feed automation settings.')
        return
      }
      setAutoSendMsg('Explore automation saved')
    } catch {
      setAutoSendMsg('Failed to save Explore automation settings.')
    } finally {
      setAutoSendSaving(false)
    }
  }, [autoSend, liveAutopilotOn, autoSendAccountId, selectedExploreSessions, autoSendRequireVerified, autoSendMinScore, autoSendMaxAge, dailySendLimit, sendSpacing])

  return (
    <div className="max-w-4xl space-y-4">
      <div className="card divide-y divide-[var(--color-line-1)]">
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Automated Feeds</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Custom automation for selected Explore sessions. Connect your sending inbox from Settings.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${
              autoSend
                ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
                : 'bg-[var(--color-ink-2)] text-[var(--color-text-4)]'
            }`}>
              {autoSend ? 'On' : 'Off'}
            </span>
            <button
              role="switch"
              aria-checked={autoSend}
              disabled={autoSendSaving || !autoSendLoaded}
              onClick={() => setAutoSend(enabled => !enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none disabled:opacity-50 ${
                autoSend ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'bg-[var(--color-ink-2)] border-[var(--color-line-2)]'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform mt-[-1px] ${autoSend ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        <div className={`px-5 py-4 space-y-5 transition-all duration-200 ${
          autoSend ? 'opacity-100 saturate-100' : 'opacity-45 saturate-50'
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
                <p className="text-[12.5px] font-medium text-[var(--color-text-1)]">Selected Explore Sessions</p>
                <p className="mt-0.5 text-[11px] leading-5 text-[var(--color-text-4)]">
                  Targeted lead sets generated from Explore prompts. Live autopilot stays {liveAutopilotOn ? 'on' : 'off'}.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-text-1)]">Explore sessions</p>
              <div className="max-h-48 overflow-y-auto rounded-2xl border border-[var(--color-line-1)] bg-white p-2">
                {exploreSessions.length === 0 ? (
                  <p className="px-2 py-3 text-[11px] text-[var(--color-text-4)]">No Explore sessions yet.</p>
                ) : exploreSessions.map(session => {
                  const checked = selectedExploreSessions.includes(session.id)
                  return (
                    <label key={session.id} className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-[var(--color-ink-2)]">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!autoSend}
                        onChange={() => setSelectedExploreSessions(prev => checked ? prev.filter(id => id !== session.id) : [...prev, session.id])}
                        className="mt-0.5 h-4 w-4 rounded border-[var(--color-line-2)]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium text-[var(--color-text-1)]">{session.label}</span>
                        <span className="block text-[10.5px] text-[var(--color-text-4)]">{session.lead_count} leads · {new Date(session.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </span>
                    </label>
                  )
                })}
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
            Explore automation uses the same safety rules as live autopilot: credits are spent only on lead unlocks, verified contacts are required, unsubscribed and bounced recipients are skipped, and daily cap plus spacing are enforced.
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-[var(--color-text-4)]">{autoSendMsg ?? 'Turn on Explore automation after selecting at least one session.'}</div>
            <button onClick={saveAutoSend} disabled={autoSendSaving || !autoSendLoaded || (autoSend && selectedExploreSessions.length === 0)} className="inline-flex items-center gap-1.5 rounded-full btn-primary px-3 py-1.5 text-xs disabled:opacity-50">
              {autoSendSaving ? 'Saving…' : autoSend ? 'Start / update Explore automation' : 'Save Explore automation off'}
            </button>
          </div>
        </div>
        <PendingFollowupsPanel />
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
  const [creditCheckoutAmount, setCreditCheckoutAmount] = useState<number | null>(null)
  const [creditCheckoutMsg, setCreditCheckoutMsg] = useState<string | null>(null)

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
    <div className="max-w-2xl space-y-4">
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
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CREDIT_TOP_UPS.map(option => (
              <button
                key={option.amount}
                onClick={() => startCreditCheckout(option.amount)}
                disabled={creditCheckoutAmount !== null}
                className="rounded-2xl border border-[var(--color-line-1)] bg-white px-3 py-2 text-left transition-colors hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent-bg)] disabled:opacity-50"
              >
                <span className="block text-[12px] font-semibold text-[var(--color-text-1)]">${option.amount}</span>
                <span className="block text-[11px] text-[var(--color-text-4)]">{option.credits} unlocks</span>
              </button>
            ))}
          </div>
          {creditCheckoutMsg && (
            <p className="mt-2 text-[11px] text-[var(--color-sig-regulation)]">{creditCheckoutMsg}</p>
          )}
        </div>
      </div>

      <ConnectedAccountsPanel />

      <ClientWorkspacePanel activeClientId={profile.active_client_id ?? null} />

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

function ExplorePanel({
  initialLeads,
  userId,
  watchlist,
  activeClientId,
  plan,
  onOpenCrmTab,
}: {
  initialLeads: Lead[]
  userId: string
  watchlist: WatchlistItem[]
  activeClientId: string | null
  plan: 'free'
  onOpenCrmTab: () => void
}) {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [lastRunSummary, setLastRunSummary] = useState<{
    inserted: number
    skipped: number
    generated: number
    durationMs: number
    requested?: number
  } | null>(null)

  useEffect(() => {
    if (!searching) {
      setElapsedSeconds(0)
      return
    }

    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)))
    }, 1000)

    return () => window.clearInterval(interval)
  }, [searching])

  async function runSearch() {
    if (!prompt.trim()) return
    setSearching(true)
    setMessage(null)
    setLastRunSummary(null)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 180_000)

    try {
      const res = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json().catch(() => null) as {
        error?: string
        ok?: boolean
        inserted?: number
        skipped?: number
        generated?: number
        requested?: number
        message?: string
        duration_ms?: number
      } | null

      if (!res.ok) {
        setMessage(data?.error ?? data?.message ?? 'Explore search failed.')
        return
      }

      const durationMs = typeof data?.duration_ms === 'number'
        ? data.duration_ms
        : Math.max(1, elapsedSeconds) * 1000

      setLastRunSummary({
        inserted: data?.inserted ?? 0,
        skipped: data?.skipped ?? 0,
        generated: data?.generated ?? 0,
        requested: data?.requested,
        durationMs,
      })
      setMessage(
        data?.message
          ?? `Added ${data?.inserted ?? 0} explore leads${typeof data?.skipped === 'number' ? `, skipped ${data.skipped}` : ''}.`,
      )
      router.refresh()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setMessage('Explore search took too long to respond. Try a tighter prompt and run it again.')
        return
      }

      setMessage('Explore search failed before the server responded.')
    } finally {
      window.clearTimeout(timeoutId)
      setSearching(false)
    }
  }

  const progressStep = EXPLORE_PROGRESS_STEPS[Math.min(Math.floor(elapsedSeconds / 8), EXPLORE_PROGRESS_STEPS.length - 1)]

  return (
    <div className="space-y-4">
      <div className="card divide-y divide-[var(--color-line-1)]">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Prompted Discovery</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">
            Describe the accounts, roles, and themes you want to pursue. Bombsell uses your brief and workspace profile to build an explore-only target list.
          </p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Example: Find 50 fintech infrastructure companies expanding into community banking, recent compliance changes, or new partnerships with regional banks."
            disabled={searching}
            className="w-full min-h-[120px] px-3 py-2 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] disabled:opacity-65"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={runSearch}
              disabled={searching || !prompt.trim()}
              className="px-3.5 py-2 rounded-full btn-primary text-xs disabled:opacity-50"
            >
              {searching ? 'Searching…' : 'Run search'}
            </button>
            {message && <p className="text-[11px] text-[var(--color-text-4)]">{message}</p>}
          </div>
          {searching && (
            <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-4)]">
                  Search in progress
                </p>
                <p className="text-[11px] text-[var(--color-text-4)]">
                  Elapsed {elapsedSeconds}s
                </p>
              </div>
              <p className="mt-2 text-sm text-[var(--color-text-2)]">{progressStep}</p>
              <p className="mt-1 text-[11px] text-[var(--color-text-4)]">
                Keep this tab open while results are generated and saved to the explore feed.
              </p>
            </div>
          )}
          {!searching && lastRunSummary && (
            <div className="rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3 text-[11px] text-[var(--color-text-4)]">
              Last run finished in {Math.max(1, Math.round(lastRunSummary.durationMs / 1000))}s.
              {typeof lastRunSummary.requested === 'number' && <> Requested {lastRunSummary.requested}.</>}
              {' '}Generated {lastRunSummary.generated} candidate{lastRunSummary.generated === 1 ? '' : 's'},
              {' '}added {lastRunSummary.inserted}, skipped {lastRunSummary.skipped}.
            </div>
          )}
        </div>
      </div>

      <div className="card border border-[var(--color-line-1)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,246,240,0.88))]">
        <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line-1)]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">Explore Results</h3>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Target accounts generated from your prompted discovery runs.
            </p>
          </div>
        </div>
        <LeadFeed
          initialLeads={initialLeads}
          userId={userId}
          watchlist={watchlist}
          activeClientId={activeClientId}
          plan={plan}
          origin="explore"
          exportFeed="explore"
          onOpenCrmTab={onOpenCrmTab}
          searchPlaceholder="Search explore leads…"
          emptyTitle="No explore leads yet"
          emptyBody="Run a prompted search above and Bombsell will add the strongest matches here."
        />
      </div>
    </div>
  )
}

function CrmWorkspacePanel({
  initialLeads,
  userId,
  watchlist,
  activeClientId,
  plan,
}: {
  initialLeads: Lead[]
  userId: string
  watchlist: WatchlistItem[]
  activeClientId: string | null
  plan: 'free'
}) {
  return (
    <div className="space-y-4">
      <CrmSyncPanel />

      <div className="card border border-[var(--color-line-1)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(243,248,246,0.9))]">
        <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line-1)]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">CRM Export Feed</h3>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Leads staged from Signal or Explore. Review this queue, then push the working set to your configured CRM.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-1)] bg-white px-3 py-1.5 text-[11px] text-[var(--color-text-3)]">
            <span className="h-2 w-2 rounded-full bg-[var(--color-sig-funding)]" />
            Export queue
          </div>
        </div>
        <LeadFeed
          initialLeads={initialLeads}
          userId={userId}
          watchlist={watchlist}
          activeClientId={activeClientId}
          plan={plan}
          origin="crm_import"
          exportFeed="crm_import"
          hideSignalTabs
          searchPlaceholder="Search CRM prospects…"
          emptyTitle="No CRM queue leads yet"
          emptyBody="Select leads in Signal Feed or Explore and add them to the CRM feed before exporting to your CRM."
        />
      </div>
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
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">CRM Sync</h2>
          <p className="text-xs text-[var(--color-text-4)] mt-0.5">
            Connect an outbound CRM endpoint. Signal and Explore leads can be staged into the CRM feed, then exported together.
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
              title="CRM queue to your CRM"
              status={savedConfig?.enabled ? 'Connected' : 'Off'}
              body={`Selected Signal and Explore leads first land in the CRM feed. From there, push the reviewed queue to ${providerLabel} via ${outboundDestination}.`}
            />
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              <div className="rounded-2xl border border-[var(--color-line-1)] bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Connection</p>
                <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">CRM export endpoint</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-3)]">
                  Bombsell POSTs selected CRM feed records to this endpoint. Keep imports off for now; leads enter this feed only when users stage them from Signal or Explore.
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
                  Enable exports to CRM
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
                {saving ? 'Saving…' : isConnected ? 'Update connection' : 'Save connection'}
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
              Signal and Explore feed actions add records to the CRM feed first. The CRM feed action pushes the reviewed queue to your provider.
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

function PendingFollowupsPanel() {
  const [followups, setFollowups] = useState<PendingFollowup[]>([])
  const [loaded, setLoaded]       = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/leads/pending-followups')
      .then(r => r.json() as Promise<{ followups?: PendingFollowup[] }>)
      .then(d => { setFollowups(d.followups ?? []); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])

  const cancel = useCallback(async (leadId: string, followupId: string) => {
    setCancelling(followupId)
    try {
      await fetch(`/api/leads/${leadId}/followup`, { method: 'DELETE' })
      setFollowups(prev => prev.filter(f => f.id !== followupId))
    } finally {
      setCancelling(null)
    }
  }, [])

  if (!loaded || followups.length === 0) return null

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
              onClick={() => f.leads && cancel(f.leads.id, f.id)}
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

  useEffect(() => {
    fetch('/api/connected-accounts')
      .then(r => r.json() as Promise<{ accounts?: ConnectedAccount[] }>)
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
        <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Sending Accounts</h2>
        <p className="text-xs text-[var(--color-text-4)] mt-0.5">
          Emails send from your own inbox. Multiple accounts rotate automatically.
        </p>
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
                  <span className="text-xs text-[var(--color-text-1)] truncate">{a.email}</span>
                </div>
                {a.last_used_at && (
                  <p className="text-[10px] text-[var(--color-text-4)] mt-0.5">
                    Last used {new Date(a.last_used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                )}
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

      <div className="px-5 py-4 flex items-center gap-2 flex-wrap">
        {ENABLE_GMAIL_CONNECT && (
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
