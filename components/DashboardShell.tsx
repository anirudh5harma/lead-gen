'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Sidebar from './Sidebar'
import LeadFeed, { type Lead } from './LeadFeed'
import WatchlistManager from './WatchlistManager'

type View = 'feed' | 'watchlist' | 'settings'

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
  email?: string
  plan?: string
  leads_used_this_month?: number
  slack_webhook_url?: string | null
  auto_send_enabled?: boolean
  allow_lead_overage?: boolean
  active_client_id?: string | null
}

interface Props {
  initialLeads: Lead[]
  userId: string
  userProfile: UserProfile
  watchlist: WatchlistItem[]
}

interface LeadDiagnostic {
  id: string
  target_company: string
  relevance_score: number
  status: string
  created_at: string
  match_debug: {
    client_name?: string
    matched_via?: string
    similarity?: number | null
    min_relevance_score?: number
  } | null
  signal: {
    signal_type?: string
    headline?: string
  } | null
}

interface OpsSummary {
  counts: {
    user_leads_last_24h: number
    pending_enrichment: number
    pending_followups: number
    active_sending_accounts: number
  }
  lead_diagnostics: LeadDiagnostic[]
}

const VIEW_TITLES: Record<View, string> = {
  feed:      'Signal Feed',
  watchlist: 'Watchlist',
  settings:  'Settings',
}

export default function DashboardShell({ initialLeads, userId, userProfile, watchlist }: Props) {
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('view') === 'settings') return 'settings'
    }
    return 'feed'
  })
  const [isRefreshing, startTransition] = useTransition()
  const router = useRouter()

  const plan      = userProfile.plan ?? 'free'
  const used      = userProfile.leads_used_this_month ?? 0
  const planLimit = PLAN_LIMITS[plan] ?? 15
  const usagePct  = planLimit > 0 ? (used / planLimit) * 100 : 0

  const [dismissed80,   setDismissed80]   = useState(false)
  const [dismissedOver, setDismissedOver] = useState(false)
  const [overageEnabled, setOverageEnabled] = useState(userProfile.allow_lead_overage ?? false)

  useEffect(() => {
    if (window.location.search.includes('view=settings')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const [mountedAtMs] = useState(() => Date.now())

  const metrics = useMemo(() => {
    const cutoff = mountedAtMs - 7 * 24 * 60 * 60 * 1000
    const recent = initialLeads.filter(l => new Date(l.created_at).getTime() >= cutoff)
    return {
      signals: recent.length,
      drafted: recent.filter(l => ['drafted', 'sent', 'replied', 'booked'].includes(l.status)).length,
      sent:    recent.filter(l => Boolean(l.sent_at)).length,
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
                {activeView === 'feed' && 'Real-time buying signals scored against your ICP'}
                {activeView === 'watchlist' && 'Companies you follow bypass relevance filtering'}
                {activeView === 'settings' && 'Billing, targeting, integrations, and diagnostics'}
              </p>
            </div>

            {/* Inline metrics */}
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
              <Link
                href="/pricing"
                className="hidden sm:inline-flex h-9 px-3.5 rounded-full btn-ghost text-[12.5px] font-medium items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5 text-[var(--color-accent)]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Upgrade
              </Link>
              <LogoutButton />
            </div>
          </div>
        </header>

        {/* View content */}
        <main className="flex-1 px-6 py-6 pb-20 overflow-auto">
          <div className="max-w-6xl mx-auto fade-in">
            {activeView === 'feed' && (
              <div className="space-y-4">
                {usagePct >= 80 && usagePct < 100 && !dismissed80 && (
                  <UsageWarningBanner
                    plan={plan as 'free' | 'pro' | 'max'}
                    used={used}
                    limit={planLimit}
                    onDismiss={() => setDismissed80(true)}
                  />
                )}
                {usagePct >= 100 && plan === 'free' && !dismissedOver && (
                  <FreePreviewBanner
                    limit={planLimit}
                    onDismiss={() => setDismissedOver(true)}
                  />
                )}
                {usagePct >= 100 && plan !== 'free' && !dismissedOver && !overageEnabled && (
                  <OverLimitModal
                    plan={plan as 'free' | 'pro' | 'max'}
                    used={used}
                    limit={planLimit}
                    overageEnabled={overageEnabled}
                    onEnableOverage={() => setOverageEnabled(true)}
                    onDismiss={() => setDismissedOver(true)}
                  />
                )}
                <LeadFeed
                  initialLeads={initialLeads}
                  userId={userId}
                  watchlist={watchlist}
                  activeClientId={userProfile.active_client_id ?? null}
                  plan={plan as 'free' | 'pro' | 'max'}
                />
              </div>
            )}
            {activeView === 'watchlist' && (
              <div className="max-w-2xl space-y-4">
                <p className="text-[12.5px] text-[var(--color-text-3)]">
                  Any signal from a watched company bypasses the relevance filter.
                </p>
                <WatchlistManager />
              </div>
            )}
            {activeView === 'settings' && (
              <SettingsPanel
                profile={userProfile}
                overageEnabled={overageEnabled}
                onOverageChange={setOverageEnabled}
              />
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

const PLAN_LABELS: Record<string, { label: string; color: string; price: string }> = {
  free: { label: 'Free', color: 'text-[var(--color-text-4)]',    price: '$0' },
  pro:  { label: 'Pro',  color: 'text-[var(--color-accent-ring)]', price: '$100/mo' },
  max:  { label: 'Max',  color: 'text-[var(--color-sig-funding)]', price: '$250/mo' },
}
const PLAN_LIMITS: Record<string, number> = { free: 15, pro: 300, max: 1500 }

function SettingsPanel({
  profile,
  overageEnabled,
  onOverageChange,
}: {
  profile: UserProfile
  overageEnabled: boolean
  onOverageChange: (enabled: boolean) => void
}) {
  const plan = profile.plan ?? 'free'
  const planMeta = PLAN_LABELS[plan] ?? PLAN_LABELS.free
  const limit = PLAN_LIMITS[plan] ?? 15
  const used = profile.leads_used_this_month ?? 0
  const pct = limit === Infinity ? 0 : Math.min(100, (used / limit) * 100)

  const [autoSend, setAutoSend] = useState(profile.auto_send_enabled ?? false)
  const [autoSendSaving, setAutoSendSaving] = useState(false)

  const toggleAutoSend = useCallback(async (enabled: boolean) => {
    setAutoSendSaving(true)
    setAutoSend(enabled)
    try {
      await fetch('/api/settings/auto-send', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_send_enabled: enabled }),
      })
    } finally {
      setAutoSendSaving(false)
    }
  }, [])

  const [slackUrl, setSlackUrl] = useState(profile.slack_webhook_url ?? '')
  const [slackSaving, setSlackSaving] = useState(false)
  const [slackMsg, setSlackMsg] = useState<string | null>(null)
  const [overageSaving, setOverageSaving] = useState(false)
  const [overageMsg, setOverageMsg] = useState<string | null>(null)

  const saveSlack = useCallback(async () => {
    setSlackSaving(true)
    setSlackMsg(null)
    try {
      const res = await fetch('/api/settings/slack-webhook', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slack_webhook_url: slackUrl || null }),
      })
      const data = await res.json() as { error?: string }
      setSlackMsg(data.error ? `Error: ${data.error}` : 'Saved')
    } catch {
      setSlackMsg('Failed to save')
    } finally {
      setSlackSaving(false)
    }
  }, [slackUrl])

  const toggleLeadOverage = useCallback(async (enabled: boolean) => {
    setOverageSaving(true)
    setOverageMsg(null)
    try {
      const res = await fetch('/api/settings/lead-overage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_lead_overage: enabled }),
      })
      const data = await res.json() as { error?: string; allow_lead_overage?: boolean }
      if (!res.ok) {
        setOverageMsg(data.error ?? 'Failed to update')
        return
      }
      onOverageChange(Boolean(data.allow_lead_overage))
      setOverageMsg(enabled ? 'Overages enabled' : 'Overages disabled')
    } catch {
      setOverageMsg('Failed to update')
    } finally {
      setOverageSaving(false)
    }
  }, [onOverageChange])

  return (
    <div className="max-w-2xl space-y-4">
      {/* Plan card */}
      <div className="card divide-y divide-[var(--color-line-1)]">
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Plan</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">Your current subscription.</p>
          </div>
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border border-[var(--color-line-2)] bg-[var(--color-ink-2)] ${planMeta.color}`}>
            {planMeta.label}
          </span>
        </div>
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-3)]">Leads · 30 days</span>
            <span className="text-[var(--color-text-2)] tabular-nums">
              {used} / {limit === Infinity ? '∞' : limit}
            </span>
          </div>
          {limit !== Infinity && (
            <div className="h-2 rounded-full bg-[var(--color-ink-2)] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-hi)] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
        <div className="px-5 py-4 flex items-center gap-3">
          {plan === 'free' && (
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-primary transition-colors"
            >
              Upgrade
            </Link>
          )}
          {plan !== 'free' && (
            <ManageBillingButton />
          )}
          {plan === 'max' && (
            <Link
              href="/api/export/crm"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-ghost transition-colors"
            >
              Export CRM CSV
            </Link>
          )}
        </div>
        {(plan === 'pro' || plan === 'max') && (
          <div className="px-5 py-4 flex items-center justify-between gap-4 border-t border-[var(--color-line-1)]">
            <div>
              <p className="text-xs font-medium text-[var(--color-text-1)]">Lead overages</p>
              <p className="text-xs text-[var(--color-text-4)] mt-0.5">
                When enabled, Bombsell keeps adding leads beyond your plan limit at $0.50 per extra lead.
              </p>
              {overageMsg && (
                <p className={`text-[11px] mt-1 ${overageMsg.includes('Failed') ? 'text-[var(--color-sig-regulation)]' : 'text-[var(--color-text-3)]'}`}>
                  {overageMsg}
                </p>
              )}
            </div>
            <button
              role="switch"
              aria-checked={overageEnabled}
              disabled={overageSaving}
              onClick={() => toggleLeadOverage(!overageEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none disabled:opacity-50 ${
                overageEnabled ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'bg-[var(--color-ink-2)] border-[var(--color-line-2)]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform mt-[-1px] ${
                  overageEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}
      </div>

      {/* Connected sending accounts — not available on free plan */}
      {plan !== 'free' && <ConnectedAccountsPanel />}

      {plan === 'max' ? (
        <ClientWorkspacePanel activeClientId={profile.active_client_id ?? null} />
      ) : (
        <ClientWorkspaceUpgradeCard />
      )}

      {/* Auto-send toggle (Pro / Max only) */}
      {(plan === 'pro' || plan === 'max') && (
        <div className="card divide-y divide-[var(--color-line-1)]">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Auto-send Follow-ups</h2>
              <p className="text-xs text-[var(--color-text-4)] mt-0.5">
                When on, a follow-up email is sent automatically ~3 days after the initial outreach if no reply is detected.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={autoSend}
              disabled={autoSendSaving}
              onClick={() => toggleAutoSend(!autoSend)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none disabled:opacity-50 ${
                autoSend ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'bg-[var(--color-ink-2)] border-[var(--color-line-2)]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform mt-[-1px] ${
                  autoSend ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <PendingFollowupsPanel />
        </div>
      )}

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

      <SequenceTemplatesPanel />
      {plan === 'max' ? <CrmSyncPanel /> : (
        <MaxFeatureUpgradeCard
          title="CRM Sync"
          body="Push lead created, sent, replied, and booked events into your CRM or automation stack. Available on Max only."
        />
      )}

      {/* Blocked companies */}
      <BlockedCompaniesPanel />

      <PipelineDiagnosticsPanel />

      {/* Slack (Max only) */}
      {plan === 'max' && (
        <div className="card divide-y divide-[var(--color-line-1)]">
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Slack Alerts</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Get notified in Slack when a high-relevance signal (score 7+/10) is detected.
            </p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <input
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value={slackUrl}
              onChange={e => setSlackUrl(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
            />
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
      )}
    </div>
  )
}

interface ClientAccountSummary {
  id: string
  name: string
}

function ClientWorkspaceUpgradeCard() {
  return (
    <div className="card divide-y divide-[var(--color-line-1)]">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Client Workspaces</h2>
        <p className="text-xs text-[var(--color-text-4)] mt-0.5">
          Keep separate feeds, targeting, templates, and CRM sync for each client or business line.
        </p>
      </div>
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <p className="text-xs text-[var(--color-text-3)]">
          Available on the Max plan only.
        </p>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-primary transition-colors"
        >
          Upgrade to Max
        </Link>
      </div>
    </div>
  )
}

function MaxFeatureUpgradeCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card divide-y divide-[var(--color-line-1)]">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
        <p className="text-xs text-[var(--color-text-4)] mt-0.5">
          {body}
        </p>
      </div>
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <p className="text-xs text-[var(--color-text-3)]">
          Available on the Max plan only.
        </p>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-primary transition-colors"
        >
          Upgrade to Max
        </Link>
      </div>
    </div>
  )
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
  const [webhookUrl, setWebhookUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/crm-sync')
      .then(r => r.json() as Promise<{ webhook_url?: string; enabled?: boolean }>)
      .then(data => {
        setWebhookUrl(data.webhook_url ?? '')
        setEnabled(Boolean(data.enabled))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/crm-sync', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: webhookUrl, enabled }),
      })
      const data = await res.json() as { error?: string }
      setMessage(data.error ?? 'Saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card divide-y divide-[var(--color-line-1)]">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-1)]">CRM Sync</h2>
        <p className="text-xs text-[var(--color-text-4)] mt-0.5">
          Push lead created/sent/replied/booked events to your CRM or automation webhook.
        </p>
      </div>
      <div className="px-5 py-4 space-y-3">
        <input
          type="url"
          value={webhookUrl}
          onChange={e => setWebhookUrl(e.target.value)}
          placeholder="https://your-crm-sync-endpoint.example.com"
          className="w-full h-9 px-3 rounded-lg bg-[var(--color-ink-2)] border border-[var(--color-line-2)] text-[12.5px]"
        />
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-2)]">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Enable CRM webhook sync
        </label>
        <button onClick={save} disabled={!loaded || saving} className="px-3.5 py-2 rounded-full btn-primary text-xs disabled:opacity-50">
          {saving ? 'Saving…' : 'Save CRM sync'}
        </button>
        {message && <p className="text-[11px] text-[var(--color-text-4)]">{message}</p>}
      </div>
    </div>
  )
}

function PipelineDiagnosticsPanel() {
  const [summary, setSummary] = useState<OpsSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ops/summary')
      .then(async response => {
        if (!response.ok) {
          throw new Error('Failed to load diagnostics')
        }
        return response.json() as Promise<OpsSummary>
      })
      .then(data => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [])

  const counts = summary?.counts

  return (
    <div className="card divide-y divide-[var(--color-line-1)]">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Pipeline Diagnostics</h2>
        <p className="text-xs text-[var(--color-text-4)] mt-0.5">
          Recent pipeline counts and the latest match explanations for your feed.
        </p>
      </div>

      {loading ? (
        <div className="px-5 py-5 text-xs text-[var(--color-text-4)]">Loading diagnostics…</div>
      ) : !summary ? (
        <div className="px-5 py-5 text-xs text-[var(--color-sig-regulation)]">
          Diagnostics are temporarily unavailable.
        </div>
      ) : (
        <>
          <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <DiagStat label="Your leads · 24h" value={String(counts?.user_leads_last_24h ?? 0)} />
            <DiagStat label="Pending enrichment" value={String(counts?.pending_enrichment ?? 0)} />
            <DiagStat label="Due follow-ups" value={String(counts?.pending_followups ?? 0)} />
            <DiagStat label="Active inboxes" value={String(counts?.active_sending_accounts ?? 0)} />
          </div>

          <div className="px-5 py-4 space-y-3">
            <h3 className="text-xs font-semibold text-[var(--color-text-1)] uppercase tracking-[0.14em]">Recent Match Explanations</h3>
            <div className="space-y-2">
              {summary.lead_diagnostics.length === 0 ? (
                <p className="text-xs text-[var(--color-text-4)]">No recent match diagnostics available yet.</p>
              ) : (
                summary.lead_diagnostics.map(lead => (
                  <div key={lead.id} className="rounded-xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/60 px-3 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-[var(--color-text-1)]">{lead.target_company}</p>
                        <p className="text-[11px] text-[var(--color-text-4)] mt-0.5">
                          {lead.signal?.signal_type ?? 'signal'} · score {lead.relevance_score} · {lead.status}
                        </p>
                      </div>
                      <span className="text-[10px] px-2 py-1 rounded-full bg-white border border-[var(--color-line-1)] text-[var(--color-text-3)]">
                        {lead.match_debug?.matched_via ?? 'matched'}
                      </span>
                    </div>
                    {lead.signal?.headline && (
                      <p className="text-[11px] text-[var(--color-text-2)] mt-2 line-clamp-2">
                        {lead.signal.headline}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {lead.match_debug?.client_name && (
                        <span className="text-[10px] px-2 py-1 rounded-full bg-white border border-[var(--color-line-1)] text-[var(--color-text-3)]">
                          workspace: {lead.match_debug.client_name}
                        </span>
                      )}
                      {typeof lead.match_debug?.similarity === 'number' && (
                        <span className="text-[10px] px-2 py-1 rounded-full bg-white border border-[var(--color-line-1)] text-[var(--color-text-3)]">
                          similarity: {lead.match_debug.similarity.toFixed(2)}
                        </span>
                      )}
                      {typeof lead.match_debug?.min_relevance_score === 'number' && (
                        <span className="text-[10px] px-2 py-1 rounded-full bg-white border border-[var(--color-line-1)] text-[var(--color-text-3)]">
                          min score: {lead.match_debug.min_relevance_score}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function DiagStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/60 px-3 py-3">
      <p className="text-[11px] text-[var(--color-text-4)]">{label}</p>
      <p className="text-lg font-medium text-[var(--color-text-1)] mt-1">{value}</p>
    </div>
  )
}

function ManageBillingButton() {
  const [loading, setLoading] = useState(false)

  async function openPortal() {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await res.json() as { url?: string }
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={openPortal}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-ghost disabled:opacity-50"
    >
      {loading ? 'Loading…' : 'Manage billing'}
    </button>
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
        microsoft_denied: 'Microsoft sign-in was cancelled.',
        google_failed:    'Google connection failed — please try again.',
        microsoft_failed: 'Microsoft connection failed — please try again.',
        invalid_state:    'Invalid OAuth state — please try again.',
        plan_required:    'Sending account connections are available on Pro and Max.',
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
    <div className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-2)] divide-y divide-[var(--color-line-1)]">
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

// ── Usage warning banner (80–99%) ─────────────────────────────────────────────

function UsageWarningBanner({
  plan,
  used,
  limit,
  onDismiss,
}: {
  plan: 'free' | 'pro' | 'max'
  used: number
  limit: number
  onDismiss: () => void
}) {
  const pct = Math.round((used / limit) * 100)
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800">
      <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <p className="text-[13px] flex-1">
        <span className="font-medium">{pct}% of your monthly limit used</span>
        {' '}— {used} of {limit} {plan === 'free' ? 'lead unlocks' : 'leads'} this period.{' '}
        <Link href="/pricing" className="underline underline-offset-2 hover:text-amber-900 transition-colors">Upgrade</Link>
        {' '}to avoid interruptions.
      </p>
      <button
        onClick={onDismiss}
        className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function FreePreviewBanner({ limit, onDismiss }: { limit: number; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--color-line-1)] bg-white text-[var(--color-text-2)]">
      <svg className="w-4 h-4 shrink-0 text-[var(--color-accent)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <p className="text-[13px] flex-1">
        <span className="font-medium text-[var(--color-text-1)]">You’ve used all {limit} free lead unlocks.</span>
        {' '}You can still browse every matched signal in preview mode. Upgrade to unlock more contacts and drafts.
      </p>
      <Link href="/pricing" className="shrink-0 h-8 px-3 rounded-full btn-primary text-[12px] font-medium inline-flex items-center">
        Upgrade
      </Link>
      <button
        onClick={onDismiss}
        className="shrink-0 text-[var(--color-text-4)] hover:text-[var(--color-text-1)] transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ── Over-limit modal (100%+) ──────────────────────────────────────────────────

function OverLimitModal({
  plan,
  used,
  limit,
  overageEnabled,
  onEnableOverage,
  onDismiss,
}: {
  plan: 'free' | 'pro' | 'max'
  used: number
  limit: number
  overageEnabled: boolean
  onEnableOverage: () => void
  onDismiss: () => void
}) {
  const [upgrading, setUpgrading] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  async function upgradeToMax() {
    setUpgrading(true)
    setUpgradeError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'max' }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      setUpgradeError(data.error || 'Unable to start checkout right now.')
    } finally {
      setUpgrading(false)
    }
  }

  async function enableOverages() {
    setEnabling(true)
    try {
      const res = await fetch('/api/settings/lead-overage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_lead_overage: true }),
      })
      if (res.ok) {
        onEnableOverage()
        onDismiss()
      }
    } finally {
      setEnabling(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md card p-7 space-y-5 shadow-2xl">
          {/* Icon */}
          <div className="w-11 h-11 rounded-xl bg-[var(--color-sig-regulation-bg)] border border-[var(--color-sig-regulation)]/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-[var(--color-sig-regulation)]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-[17px] font-semibold text-[var(--color-text-1)] tracking-tight">
              {plan === 'free' ? 'Free limit reached' : 'Monthly limit reached'}
            </h2>
            <p className="text-[13px] text-[var(--color-text-3)] leading-relaxed">
              {plan === 'free' && (
                <>You&rsquo;ve used all {limit} free lead unlocks this period. You can still browse matched signals in preview mode, or upgrade to unlock more contacts and drafts.</>
              )}
              {plan === 'pro' && (
                <>You&rsquo;ve used all {limit} Pro leads in your current 30-day window. You can keep the feed running with <strong className="text-[var(--color-text-1)]">$0.50 per extra lead</strong>, or upgrade to Max for 1,500 leads/mo.</>
              )}
              {plan === 'max' && (
                <>You&rsquo;ve used all {limit} Max leads in your current 30-day window. You can keep the feed running with <strong className="text-[var(--color-text-1)]">$0.50 per extra lead</strong>, billed automatically at month end.</>
              )}
            </p>
          </div>

          {/* Usage bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-[var(--color-text-4)]">
              <span>{used} used</span>
              <span>{limit} limit</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--color-ink-2)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--color-sig-regulation)]" style={{ width: '100%' }} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            {plan === 'free' && (
              <>
                <Link
                  href="/pricing"
                  className="h-10 rounded-full btn-primary text-[13px] font-medium flex items-center justify-center"
                >
                  Upgrade to Pro or Max
                </Link>
                <button
                  onClick={onDismiss}
                  className="h-10 rounded-full btn-ghost text-[13px] flex items-center justify-center"
                >
                  Maybe later
                </button>
              </>
            )}

            {plan === 'pro' && (
              <>
                <button
                  onClick={upgradeToMax}
                  disabled={upgrading}
                  className="h-10 rounded-full btn-primary text-[13px] font-medium flex items-center justify-center disabled:opacity-60"
                >
                  {upgrading ? 'Redirecting…' : 'Upgrade to Max — 1,500 leads/mo'}
                </button>
                <button
                  onClick={enableOverages}
                  disabled={enabling || overageEnabled}
                  className="h-10 rounded-full btn-ghost text-[13px] flex items-center justify-center gap-2"
                >
                  {enabling ? 'Enabling…' : overageEnabled ? 'Overages already enabled' : 'Continue with $0.50/lead overages'}
                  <span className="text-[11px] text-[var(--color-text-4)]">billed month end</span>
                </button>
                {upgradeError && (
                  <p className="rounded-lg border border-[var(--color-sig-regulation)]/20 bg-[var(--color-sig-regulation-bg)] px-3 py-2 text-xs text-[var(--color-sig-regulation)]">
                    {upgradeError}
                  </p>
                )}
              </>
            )}

            {plan === 'max' && (
              <>
                <button
                  onClick={enableOverages}
                  disabled={enabling || overageEnabled}
                  className="h-10 rounded-full btn-primary text-[13px] font-medium flex items-center justify-center disabled:opacity-60"
                >
                  {enabling ? 'Enabling…' : overageEnabled ? 'Overages already enabled' : 'Continue with $0.50/lead overages'}
                </button>
                <p className="text-center text-[11px] text-[var(--color-text-4)]">Charged automatically at month end</p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
