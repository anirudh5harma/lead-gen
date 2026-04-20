'use client'

import { useMemo, useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import LeadFeed, { type Lead } from './LeadFeed'
import WatchlistManager from './WatchlistManager'
import ShortcutsHint from './ShortcutsHint'

type View = 'feed' | 'watchlist' | 'settings'

interface WatchlistItem {
  id: string
  company_name: string
  company_domain: string | null
}

interface UserProfile {
  company_name: string
  services_description: string
  icp_keywords: string[] | null
  email?: string
  plan?: string
  leads_used_this_month?: number
  slack_webhook_url?: string | null
  auto_send_enabled?: boolean
}

interface Props {
  initialLeads: Lead[]
  userId: string
  userProfile: UserProfile
  watchlist: WatchlistItem[]
}

const VIEW_TITLES: Record<View, string> = {
  feed:      'Signal Feed',
  watchlist: 'Watchlist',
  settings:  'Settings',
}

export default function DashboardShell({ initialLeads, userId, userProfile, watchlist }: Props) {
  const [activeView, setActiveView] = useState<View>('feed')
  const [isRefreshing, startTransition] = useTransition()
  const router = useRouter()

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
        companyName={userProfile.company_name}
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
                {activeView === 'settings' && 'Billing, targeting, and integrations'}
              </p>
            </div>

            {/* Inline metrics */}
            {activeView === 'feed' && (
              <div className="hidden lg:flex items-center gap-2 ml-6">
                <MetricChip value={metrics.signals} label="Signals · 7d" />
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
              <a
                href="/pricing"
                className="hidden sm:inline-flex h-9 px-3.5 rounded-full btn-ghost text-[12.5px] font-medium items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5 text-[var(--color-accent)]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Upgrade
              </a>
            </div>
          </div>
        </header>

        {/* View content */}
        <main className="flex-1 px-6 py-6 pb-20 overflow-auto">
          <div className="max-w-6xl mx-auto fade-in">
            {activeView === 'feed' && (
              <LeadFeed initialLeads={initialLeads} userId={userId} watchlist={watchlist} />
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
              <SettingsPanel profile={userProfile} />
            )}
          </div>
        </main>

        <ShortcutsHint />
      </div>
    </div>
  )
}

function MetricChip({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className={`inline-flex items-baseline gap-1.5 px-3 h-8 rounded-full border text-[12px] ${
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
  pro:  { label: 'Pro',  color: 'text-[var(--color-accent-ring)]', price: '$69/mo' },
  max:  { label: 'Max',  color: 'text-[var(--color-sig-funding)]', price: '$169/mo' },
}
const PLAN_LIMITS: Record<string, number> = { free: 15, pro: 300, max: 1500 }

function SettingsPanel({ profile }: { profile: UserProfile }) {
  const plan = profile.plan ?? 'free'
  const planMeta = PLAN_LABELS[plan] ?? PLAN_LABELS.free
  const limit = PLAN_LIMITS[plan] ?? 15
  const used = profile.leads_used_this_month ?? 0
  const pct = limit === Infinity ? 0 : Math.min(100, (used / limit) * 100)

  const [autoSend, setAutoSend] = useState(profile.auto_send_enabled ?? true)
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
            <span className="text-[var(--color-text-3)]">Emails sent · 30 days</span>
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
            <a
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-primary transition-colors"
            >
              Upgrade
            </a>
          )}
          {plan !== 'free' && (
            <ManageBillingButton />
          )}
          {plan === 'max' && (
            <a
              href="/api/export/crm"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-ghost transition-colors"
            >
              Export CRM CSV
            </a>
          )}
        </div>
      </div>

      {/* Auto-send toggle (Pro / Max only) */}
      {(plan === 'pro' || plan === 'max') && (
        <div className="card">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Auto-send Follow-ups</h2>
              <p className="text-xs text-[var(--color-text-4)] mt-0.5">
                When on, follow-up emails are sent automatically 3 days after the initial outreach.
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
          <a
            href="/onboarding"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-primary transition-colors"
          >
            Edit targeting
          </a>
        </div>
      </div>

      {/* Blocked companies */}
      <BlockedCompaniesPanel />

      {/* Slack (Max only) */}
      {plan === 'max' && (
        <div className="card divide-y divide-[var(--color-line-1)]">
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Slack Alerts</h2>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Get notified in Slack when a high-score signal (70+) is detected.
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 px-5 py-3 text-xs">
      <dt className="text-[10px] uppercase tracking-widest text-[var(--color-text-4)] pt-0.5 font-medium">{label}</dt>
      <dd className="text-[var(--color-text-1)]">{children}</dd>
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
