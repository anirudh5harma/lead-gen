'use client'

import { useMemo, useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Lead } from '@/lib/leads'
import type { View, UserProfile } from './dashboard/types'
import Sidebar from './dashboard/Sidebar'
import InboxView from './dashboard/InboxView'
import AccountsView from './dashboard/AccountsView'
import MarketingView from './dashboard/MarketingView'
import InsightsView from './dashboard/InsightsView'
import AutopilotView from './dashboard/AutopilotView'
import SettingsView from './dashboard/SettingsView'

const VIEW_TITLES: Record<View, string> = {
  inbox:     'Work',
  accounts:  'Accounts',
  marketing: 'Marketing',
  insights:  'Insights',
  autopilot: 'GTM Engine',
  settings:  'Settings',
}

const VIEW_SUBTITLES: Record<View, string> = {
  inbox:     'The highest-value account moves to review next.',
  accounts:  'Context, signals, people, and next actions by account.',
  marketing: 'Signal-backed content ideas and campaign angles.',
  insights:  'AI-native recommendations with actionable CTAs.',
  autopilot: 'Market coverage, sending mode, and safety rules.',
  settings:  'ICP, inboxes, credits, and guardrails.',
}

interface Props {
  initialLeads: Lead[]
  userProfile: UserProfile
}

export default function DashboardShell({ initialLeads, userProfile }: Props) {
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const requestedView = params.get('view')
      if (requestedView === 'inbox' || requestedView === 'accounts' || requestedView === 'marketing' || requestedView === 'insights' || requestedView === 'autopilot' || requestedView === 'settings') {
        return requestedView
      }
    }
    return 'inbox'
  })
  const [isRefreshing, startTransition] = useTransition()
  const router = useRouter()

  const [leadCreditBalance, setLeadCreditBalance] = useState(userProfile.lead_credit_balance ?? 0)
  const displayProfile = useMemo(() => ({ ...userProfile, lead_credit_balance: leadCreditBalance }), [leadCreditBalance, userProfile])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const paymentId = params.get('payment_id') ?? params.get('paymentId') ?? params.get('dodo_payment_id') ?? ''
    const checkoutSessionId = params.get('checkout_session_id') ?? params.get('checkout_session') ?? params.get('session_id') ?? params.get('checkout_id') ?? ''
    const isCreditReturn = params.get('credits') === '1'

    if (isCreditReturn && (paymentId || checkoutSessionId)) {
      let cancelled = false
      ;(async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const res = await fetch('/api/billing/credits/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_id: paymentId || undefined, checkout_session_id: checkoutSessionId || undefined }),
          }).catch(() => null)
          const data = await res?.json().catch(() => null) as { balance?: number; pending?: boolean } | null
          if (cancelled) return
          if (res?.ok && typeof data?.balance === 'number') { setLeadCreditBalance(data.balance); router.refresh(); break }
          if (res && !data?.pending && res.status !== 409) break
          await new Promise(r => setTimeout(r, 1500))
        }
        if (!cancelled) window.history.replaceState({}, '', window.location.pathname)
      })()
      return () => { cancelled = true }
    }
    if (window.location.search.includes('view=')) window.history.replaceState({}, '', window.location.pathname)
  }, [router])

  function refresh() { startTransition(() => router.refresh()) }

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
              <h1 className="text-[15px] font-semibold text-[var(--color-text-1)] tracking-tight truncate">{VIEW_TITLES[activeView]}</h1>
              <p className="text-[11px] text-[var(--color-text-3)] truncate">{VIEW_SUBTITLES[activeView]}</p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={refresh}
                disabled={isRefreshing}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-ink-2)] disabled:opacity-50 transition-colors"
                title="Refresh"
              >
                <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 014.582 15M19.419 15H15" />
                </svg>
              </button>
              <button
                onClick={() => setActiveView('settings')}
                className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-white px-3 text-[12px] font-semibold text-[var(--color-text-2)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text-1)] transition-colors"
                title="Lead credit balance"
              >
                <span className="tabular-nums text-[var(--color-accent-ring)]">{leadCreditBalance}</span>
                <span>credits</span>
              </button>
              <button
                onClick={() => setActiveView('settings')}
                className="hidden sm:inline-flex h-9 px-3.5 rounded-full btn-primary text-[12.5px] font-semibold items-center gap-1.5"
              >
                Add credits
              </button>
              <LogoutButton />
            </div>
          </div>
        </header>

        {/* View content */}
        <main className="flex-1 overflow-auto scroll-smooth px-6 py-6 pb-20">
          <div className="max-w-6xl mx-auto fade-in">
            {activeView === 'inbox' && <InboxView leads={initialLeads} onNavigate={setActiveView} />}
            {activeView === 'accounts' && <AccountsView />}
            {activeView === 'marketing' && <MarketingView />}
            {activeView === 'insights' && <InsightsView />}
            {activeView === 'autopilot' && <AutopilotView />}
            {activeView === 'settings' && <SettingsView profile={displayProfile} />}
          </div>
        </main>
      </div>
    </div>
  )
}

function LogoutButton() {
  const [loading, setLoading] = useState(false)
  async function logout() {
    setLoading(true)
    const supabase = (await import('@/lib/supabase/client')).createClient()
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    </button>
  )
}
