'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Sidebar from './Sidebar'
import LeadFeed, { type Lead } from './LeadFeed'
import WatchlistManager from './WatchlistManager'

type View = 'feed' | 'explore' | 'crm' | 'mcp' | 'watchlist' | 'settings'

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
  lead_credit_balance?: number
  slack_webhook_url?: string | null
  slack_min_score?: number | null
  active_client_id?: string | null
}

interface Props {
  initialLeads: Lead[]
  userId: string
  userProfile: UserProfile
  watchlist: WatchlistItem[]
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
  feed:      'Signal Feed',
  explore:   'Explore',
  crm:       'CRM',
  mcp:       'MCP',
  watchlist: 'Watchlist',
  settings:  'Settings',
}

export default function DashboardShell({ initialLeads, userId, userProfile, watchlist }: Props) {
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const requestedView = params.get('view')
      if (requestedView === 'feed' || requestedView === 'explore' || requestedView === 'crm' || requestedView === 'mcp' || requestedView === 'watchlist' || requestedView === 'settings') {
        return requestedView
      }
    }
    return 'feed'
  })
  const [isRefreshing, startTransition] = useTransition()
  const router = useRouter()

  const plan      = userProfile.plan ?? 'free'
  const used      = userProfile.leads_used_this_month ?? 0
  const planLimit = PLAN_LIMITS[plan] ?? 15
  const usagePct  = planLimit > 0 ? (used / planLimit) * 100 : 0
  const [leadCreditBalance, setLeadCreditBalance] = useState(userProfile.lead_credit_balance ?? 0)
  const displayProfile = useMemo(() => ({
    ...userProfile,
    lead_credit_balance: leadCreditBalance,
  }), [leadCreditBalance, userProfile])

  const [dismissed80,   setDismissed80]   = useState(false)
  const [dismissedOver, setDismissedOver] = useState(false)

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
                {activeView === 'explore' && 'Prompt-driven lead discovery based on who you want to target next'}
                {activeView === 'crm' && 'Connect your CRM, import outreach targets, and push exports back out'}
                {activeView === 'mcp' && 'Let agent frameworks consume your GTM context and lead workflows'}
                {activeView === 'watchlist' && 'Companies you follow bypass relevance filtering'}
                {activeView === 'settings' && 'Billing, targeting, automations, and diagnostics'}
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
              {activeView === 'feed' && (
                <button
                  onClick={() => setActiveView('settings')}
                  className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-white px-3 text-[12px] font-semibold text-[var(--color-text-2)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text-1)] transition-colors"
                  title="Lead credit balance"
                >
                  <span className="tabular-nums text-[var(--color-accent-ring)]">{leadCreditBalance}</span>
                  <span>credits</span>
                </button>
              )}
              <Link
                href="/pricing"
                className="hidden sm:inline-flex h-9 px-3.5 rounded-full btn-ghost text-[12.5px] font-medium items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5 text-[var(--color-accent)]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Upgrade
              </Link>
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
            {activeView === 'feed' && (
              <div className="space-y-4">
                {usagePct >= 80 && usagePct < 100 && !dismissed80 && (
                  <UsageWarningBanner
                    plan={plan as 'free' | 'pro'}
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
                {usagePct >= 100 && plan !== 'free' && !dismissedOver && (
                  <OverLimitModal
                    plan={plan as 'free' | 'pro'}
                    used={used}
                    limit={planLimit}
                    onDismiss={() => setDismissedOver(true)}
                  />
                )}
                <LeadFeed
                  initialLeads={initialLeads}
                  userId={userId}
                  watchlist={watchlist}
                  activeClientId={userProfile.active_client_id ?? null}
                  plan={plan as 'free' | 'pro'}
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
                plan={plan as 'free' | 'pro'}
                onOpenCrmTab={() => setActiveView('crm')}
              />
            )}
            {activeView === 'crm' && (
              <CrmWorkspacePanel
                initialLeads={initialLeads}
                userId={userId}
                watchlist={watchlist}
                activeClientId={userProfile.active_client_id ?? null}
                plan={plan as 'free' | 'pro'}
              />
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
            ['Leads', 'Live, Explore, and CRM-imported leads.'],
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

const PLAN_LABELS: Record<string, { label: string; color: string; price: string }> = {
  free: { label: 'Free', color: 'text-[var(--color-text-4)]',    price: '$0' },
  pro:  { label: 'Pro',  color: 'text-[var(--color-accent-ring)]', price: '$129/mo' },
}
const PLAN_LIMITS: Record<string, number> = { free: 15, pro: 500 }
const CREDIT_TOP_UPS = [
  { amount: 5, credits: 20 },
  { amount: 20, credits: 80 },
  { amount: 50, credits: 200 },
  { amount: 100, credits: 400 },
]
const AUTO_SEND_FEED_OPTIONS: Array<{ key: 'live' | 'explore' | 'crm_import'; label: string; description: string }> = [
  { key: 'live', label: 'Live Signal Feed', description: 'Auto-send follow-ups for live signal-driven leads.' },
  { key: 'explore', label: 'Explore Feed', description: 'Auto-send follow-ups for prompted discovery leads.' },
  { key: 'crm_import', label: 'CRM Feed', description: 'Auto-send follow-ups for CRM-imported prospects.' },
]

function SettingsPanel({
  profile,
}: {
  profile: UserProfile
}) {
  const plan = profile.plan ?? 'free'
  const planMeta = PLAN_LABELS[plan] ?? PLAN_LABELS.free
  const limit = PLAN_LIMITS[plan] ?? 15
  const used = profile.leads_used_this_month ?? 0
  const leadCreditBalance = profile.lead_credit_balance ?? 0
  const pct = limit === Infinity ? 0 : Math.min(100, (used / limit) * 100)

  const [autoSend, setAutoSend] = useState(false)
  const [autoSendSaving, setAutoSendSaving] = useState(false)
  const [autoSendLoaded, setAutoSendLoaded] = useState(false)
  const [autoSendMsg, setAutoSendMsg] = useState<string | null>(null)
  const [autoSendAccounts, setAutoSendAccounts] = useState<AutoSendAccount[]>([])
  const [autoSendAccountId, setAutoSendAccountId] = useState<string | null>(null)
  const [autoSendFeeds, setAutoSendFeeds] = useState<Array<'live' | 'explore' | 'crm_import'>>(['live', 'explore', 'crm_import'])
  const [autoSendRequireVerified, setAutoSendRequireVerified] = useState(false)
  const [autoSendMinScore, setAutoSendMinScore] = useState(1)
  const [autoSendMaxAge, setAutoSendMaxAge] = useState(30)

  useEffect(() => {
    if (plan !== 'pro') return

    let cancelled = false
    fetch('/api/settings/auto-send', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => null) as {
          error?: string
          policy?: {
            enabled?: boolean
            connected_account_id?: string | null
            target_origins?: Array<'live' | 'explore' | 'crm_import'>
            require_verified_contact?: boolean
            min_relevance_score?: number
            max_lead_age_days?: number
          }
          accounts?: AutoSendAccount[]
        } | null
        if (cancelled || !data) return
        if (!res.ok) {
          setAutoSendMsg(data.error ?? 'Failed to load feed automation settings.')
          setAutoSendLoaded(true)
          return
        }
        setAutoSend(Boolean(data.policy?.enabled))
        setAutoSendAccountId(data.policy?.connected_account_id ?? null)
        setAutoSendFeeds(data.policy?.target_origins?.length ? data.policy.target_origins : ['live', 'explore', 'crm_import'])
        setAutoSendRequireVerified(Boolean(data.policy?.require_verified_contact))
        setAutoSendMinScore(data.policy?.min_relevance_score ?? 1)
        setAutoSendMaxAge(data.policy?.max_lead_age_days ?? 30)
        setAutoSendAccounts(data.accounts ?? [])
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
  }, [plan])

  const saveAutoSend = useCallback(async () => {
    setAutoSendSaving(true)
    setAutoSendMsg(null)
    try {
      const res = await fetch('/api/settings/auto-send', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: autoSend,
          connected_account_id: autoSendAccountId,
          target_origins: autoSendFeeds,
          require_verified_contact: autoSendRequireVerified,
          min_relevance_score: autoSendMinScore,
          max_lead_age_days: autoSendMaxAge,
        }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        setAutoSendMsg(data?.error ?? 'Failed to save feed automation settings.')
        return
      }
      setAutoSendMsg('Feed automation saved')
    } catch {
      setAutoSendMsg('Failed to save feed automation settings.')
    } finally {
      setAutoSendSaving(false)
    }
  }, [autoSend, autoSendAccountId, autoSendFeeds, autoSendRequireVerified, autoSendMinScore, autoSendMaxAge])

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
        </div>
        <div className="px-5 py-4 border-t border-[var(--color-line-1)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--color-text-1)]">Add lead credits</p>
              <p className="text-xs text-[var(--color-text-4)] mt-0.5">
                Credits unlock leads after your included quota is used. Each $1 adds 4 lead unlocks.
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

      {/* Connected sending accounts — not available on free plan */}
      {plan !== 'free' && <ConnectedAccountsPanel />}

      {plan === 'pro' ? (
        <ClientWorkspacePanel activeClientId={profile.active_client_id ?? null} />
      ) : (
        <ClientWorkspaceUpgradeCard />
      )}

      {/* Auto-send toggle (Pro only) */}
      {plan === 'pro' && (
        <div className="card divide-y divide-[var(--color-line-1)]">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Feed Automation</h2>
              <p className="text-xs text-[var(--color-text-4)] mt-0.5">
                Choose which feeds are eligible for automatic follow-up sending after the initial outreach goes out and no reply is detected.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={autoSend}
              disabled={autoSendSaving || !autoSendLoaded}
              onClick={() => setAutoSend(enabled => !enabled)}
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
          <div className="px-5 py-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--color-text-1)]">Sending inbox</span>
                <select
                  value={autoSendAccountId ?? ''}
                  onChange={e => setAutoSendAccountId(e.target.value || null)}
                  className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px] text-[var(--color-text-1)]"
                >
                  <option value="">Any active inbox</option>
                  {autoSendAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {(account.display_name || account.email)} · {account.provider}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[var(--color-text-1)]">Min score</span>
                  <select
                    value={autoSendMinScore}
                    onChange={e => setAutoSendMinScore(Number(e.target.value))}
                    className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px] text-[var(--color-text-1)]"
                  >
                    {Array.from({ length: 10 }, (_, index) => index + 1).map(score => (
                      <option key={score} value={score}>{score}+</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[var(--color-text-1)]">Max age</span>
                  <select
                    value={autoSendMaxAge}
                    onChange={e => setAutoSendMaxAge(Number(e.target.value))}
                    className="w-full h-9 rounded-lg border border-[var(--color-line-2)] bg-white px-3 text-[12.5px] text-[var(--color-text-1)]"
                  >
                    {[7, 14, 30, 60, 90].map(days => (
                      <option key={days} value={days}>{days} days</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-text-1)]">Eligible feeds</p>
              <div className="grid gap-2">
                {AUTO_SEND_FEED_OPTIONS.map(option => {
                  const checked = autoSendFeeds.includes(option.key)
                  return (
                    <label key={option.key} className="flex items-start gap-3 rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setAutoSendFeeds(prev =>
                          checked
                            ? prev.filter(feed => feed !== option.key)
                            : [...prev, option.key]
                        )}
                        className="mt-0.5 h-4 w-4 rounded border-[var(--color-line-2)]"
                      />
                      <span>
                        <span className="block text-[12.5px] font-medium text-[var(--color-text-1)]">{option.label}</span>
                        <span className="block text-[11px] text-[var(--color-text-4)] mt-0.5">{option.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <label className="flex items-start justify-between gap-4 rounded-2xl border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3">
              <span>
                <span className="block text-[12.5px] font-medium text-[var(--color-text-1)]">Require verified contacts</span>
                <span className="block text-[11px] text-[var(--color-text-4)] mt-0.5">
                  Only auto-send follow-ups when the contact has been verified during enrichment.
                </span>
              </span>
              <button
                role="switch"
                aria-checked={autoSendRequireVerified}
                onClick={() => setAutoSendRequireVerified(value => !value)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none ${
                  autoSendRequireVerified ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'bg-[var(--color-ink-1)] border-[var(--color-line-2)]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform mt-[-1px] ${
                    autoSendRequireVerified ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>

            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-[var(--color-text-4)]">
                {autoSendMsg ?? 'Auto-follow-up uses the same lead record across all feeds; the selected feeds only control eligibility.'}
              </div>
              <button
                onClick={saveAutoSend}
                disabled={autoSendSaving || !autoSendLoaded || autoSendFeeds.length === 0}
                className="inline-flex items-center gap-1.5 rounded-full btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {autoSendSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
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

      {/* Slack (Pro only) */}
      {plan === 'pro' && (
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
      )}

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
  plan: 'free' | 'pro'
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
  plan: 'free' | 'pro'
}) {
  return (
    <div className="space-y-4">
      <CrmSyncPanel />

      <div className="card border border-[var(--color-line-1)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(243,248,246,0.9))]">
        <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line-1)]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-1)]">CRM Outreach Feed</h3>
            <p className="text-xs text-[var(--color-text-4)] mt-0.5">
              Imported CRM records that are ready for outbound sequencing and manual follow-up.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-1)] bg-white px-3 py-1.5 text-[11px] text-[var(--color-text-3)]">
            <span className="h-2 w-2 rounded-full bg-[var(--color-sig-funding)]" />
            Separate from signal quota
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
          emptyTitle="No CRM prospects imported yet"
          emptyBody="Enable CRM imports here, then send records into Bombsell to create an outreach-ready CRM feed."
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
          Available on the Pro plan.
        </p>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full btn-primary transition-colors"
        >
          Upgrade to Pro
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
  const [provider, setProvider] = useState('webhook')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [importEnabled, setImportEnabled] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [copiedImportUrl, setCopiedImportUrl] = useState(false)
  const [isEditing, setIsEditing] = useState(true)
  const [savedConfig, setSavedConfig] = useState<{
    provider: string
    webhookUrl: string
    enabled: boolean
    importEnabled: boolean
    importUrl: string
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
        import_enabled?: boolean
        import_url?: string
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
          importEnabled: Boolean(data.import_enabled),
          importUrl: data.import_url ?? '',
        }
        setProvider(nextConfig.provider)
        setWebhookUrl(nextConfig.webhookUrl)
        setEnabled(nextConfig.enabled)
        setImportEnabled(nextConfig.importEnabled)
        setImportUrl(nextConfig.importUrl)
        setSavedConfig(nextConfig)
        setIsEditing(!hasCrmConnection(nextConfig))
        setProviders(data.providers ?? [])
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const selectedProvider = providers.find(item => item.id === provider) ?? providers[0] ?? null

  async function copyImportUrl() {
    if (!importUrl) return
    try {
      await navigator.clipboard.writeText(importUrl)
      setCopiedImportUrl(true)
      window.setTimeout(() => setCopiedImportUrl(false), 1500)
    } catch {
      setCopiedImportUrl(false)
    }
  }

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
          import_enabled: importEnabled,
        }),
      })
      const data = await res.json() as {
        error?: string
        provider?: string
        webhook_url?: string
        enabled?: boolean
        import_enabled?: boolean
        import_url?: string
      }
      if (!res.ok || data.error) {
        setMessage(data.error ?? 'Failed to save CRM sync')
        return
      }
      const nextConfig = {
        provider: data.provider ?? provider,
        webhookUrl: data.webhook_url ?? webhookUrl,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : enabled,
        importEnabled: typeof data.import_enabled === 'boolean' ? data.import_enabled : importEnabled,
        importUrl: data.import_url ?? importUrl,
      }
      setProvider(nextConfig.provider)
      setWebhookUrl(nextConfig.webhookUrl)
      setEnabled(nextConfig.enabled)
      setImportEnabled(nextConfig.importEnabled)
      setImportUrl(nextConfig.importUrl)
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
            Two separate workflows: export Bombsell leads to your CRM, or import CRM-held targets into the CRM Outreach Feed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill active={enabled} activeLabel="Outbound on" idleLabel="Outbound off" />
          <StatusPill active={importEnabled} activeLabel="Imports on" idleLabel="Imports off" />
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
          <div className="grid gap-3 lg:grid-cols-2">
            <CrmWorkflowSummary
              eyebrow="Export workflow"
              title="Bombsell to CRM"
              status={savedConfig?.enabled ? 'Connected' : 'Off'}
              body={`Push selected or visible feed leads to ${providerLabel} via ${outboundDestination}. Export actions live in Signal, Explore, and CRM feeds.`}
            />
            <div className="rounded-2xl border border-[var(--color-line-1)] bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Import workflow</p>
                  <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">CRM to Bombsell</h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-3)]">
                    Send CRM records to this URL. Each batch appears as a session in the CRM Outreach Feed.
                  </p>
                </div>
                <StatusPill active={Boolean(savedConfig?.importEnabled)} activeLabel="On" idleLabel="Off" />
              </div>
              <div className="mt-3 flex h-9 min-w-0 rounded-lg border border-[var(--color-line-2)] bg-[var(--color-ink-2)]">
                <input
                  readOnly
                  value={savedConfig?.importUrl ?? ''}
                  className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-[12px] text-[var(--color-text-2)]"
                />
                <button
                  onClick={copyImportUrl}
                  disabled={!importUrl}
                  className="shrink-0 border-l border-[var(--color-line-2)] bg-white px-3 text-[11px] font-medium text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-ink-2)] disabled:opacity-50"
                >
                  {copiedImportUrl ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-[var(--color-line-1)] bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Export workflow</p>
                <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">Bombsell to CRM</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-3)]">
                  Used by Export to CRM buttons in each feed. Bombsell POSTs the exact selected or visible working set to your endpoint.
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

              <div className="rounded-2xl border border-[var(--color-line-1)] bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">Import workflow</p>
                <h3 className="mt-1 text-sm font-semibold text-[var(--color-text-1)]">CRM to Bombsell</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-3)]">
                  Use this URL in your CRM automation to create or refresh records in the CRM Outreach Feed, grouped by import session.
                </p>
                <div className="mt-3 flex h-9 min-w-0 rounded-lg border border-[var(--color-line-2)] bg-[var(--color-ink-2)]">
                  <input
                    readOnly
                    value={importUrl}
                    placeholder="Import URL appears after save"
                    className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-[12px] text-[var(--color-text-2)]"
                  />
                  <button
                    onClick={copyImportUrl}
                    disabled={!importUrl}
                    className="shrink-0 border-l border-[var(--color-line-2)] bg-white px-3 text-[11px] font-medium text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-ink-2)] disabled:opacity-50"
                  >
                    {copiedImportUrl ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-2)]">
                  <input type="checkbox" checked={importEnabled} onChange={e => setImportEnabled(e.target.checked)} />
                  Enable CRM imports
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
                    setImportEnabled(savedConfig.importEnabled)
                    setImportUrl(savedConfig.importUrl)
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
            <div className="grid gap-3 md:grid-cols-2">
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
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-4)] mb-2">Import fields</p>
                <div className="space-y-1.5">
                  {selectedProvider.importFields.map(field => (
                    <div key={`${field.ourField}-${field.crmField}`} className="flex items-start justify-between gap-3 text-[11px]">
                      <span className="text-[var(--color-text-2)]">{field.ourField}{field.required ? ' *' : ''}</span>
                      <span className="text-[var(--color-text-4)] text-right">{field.crmField}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-[var(--color-text-4)]">
              Export actions now live on Signal Feed and Explore so reps can push the exact working set they are reviewing.
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
  importEnabled: boolean
  importUrl: string
}) {
  return (config.enabled && Boolean(config.webhookUrl)) || (config.importEnabled && Boolean(config.importUrl))
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
        plan_required:    'Sending account connections are available on Pro.',
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

// ── Usage warning banner (80–99%) ─────────────────────────────────────────────

function UsageWarningBanner({
  plan,
  used,
  limit,
  onDismiss,
}: {
  plan: 'free' | 'pro'
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
  onDismiss,
}: {
  plan: 'free' | 'pro'
  used: number
  limit: number
  onDismiss: () => void
}) {
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
                <>You&rsquo;ve used all {limit} Pro leads in your current 30-day window. Additional unlocks now draw from your prepaid lead credit balance.</>
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
                  Upgrade to Pro
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
                  onClick={onDismiss}
                  className="h-10 rounded-full btn-primary text-[13px] flex items-center justify-center"
                >
                  Got it
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
