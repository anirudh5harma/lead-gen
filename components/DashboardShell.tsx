'use client'

import { useMemo, useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Lead } from '@/lib/leads'
import type { View, UserProfile } from './dashboard/types'
import Sidebar from './dashboard/Sidebar'
import HomeView from './dashboard/HomeView'
import InboxView from './dashboard/InboxView'
import OutreachView from './dashboard/OutreachView'
import ExploreView from './dashboard/ExploreView'
import MarketingView from './dashboard/MarketingView'
import CampaignsView from './dashboard/CampaignsView'
import AudienceView from './dashboard/AudienceView'
import PipelineView from './dashboard/PipelineView'
import AnalyticsView from './dashboard/AnalyticsView'
import AccountsView from './dashboard/AccountsView'
import AutopilotView from './dashboard/AutopilotView'
import SequencesView from './dashboard/SequencesView'
import SettingsView from './dashboard/SettingsView'
import PlanGate from './PlanGate'
import { canAccessView } from '@/lib/plan-access'
import type { SubscriptionTier } from '@/lib/lead-credits'

const VIEW_TITLES: Record<View, string> = {
  home:                       'Home',
  'sales/inbox':              'Work Inbox',
  'sales/outreach':           'Outreach',
  'sales/explore':            'Explore',
  'marketing/content':        'Content Overview',
  'marketing/content/posts':  'Posts',
  'marketing/content/blogs':  'Blogs',
  'marketing/content/videos': 'Videos',
  'marketing/campaigns':      'Campaigns',
  'marketing/audience':       'Audience',
  'revenue/pipeline':         'Pipeline',
  'revenue/analytics':        'Analytics',
  accounts:                   'Accounts',
  'engine/autopilot':         'Autopilot',
  'engine/sequences':         'Sequences',
  settings:                   'Settings',
}

const VIEW_SUBTITLES: Record<View, string> = {
  home:                       'GTM snapshot and quick actions.',
  'sales/inbox':              'The highest-value account moves to review next.',
  'sales/outreach':           'Drafts, sent messages, and reply tracking.',
  'sales/explore':            'Search companies and import from CRM.',
  'marketing/content':        'Marketing calendar, distribution mix, and account readiness.',
  'marketing/content/posts':  'Social posts for LinkedIn and X.',
  'marketing/content/blogs':  'Long-form articles and blog drafts.',
  'marketing/content/videos': 'Video scripts and production-ready concepts.',
  'marketing/campaigns':      'Group content into campaigns with timelines.',
  'marketing/audience':       'ICP performance and persona analytics.',
  'revenue/pipeline':         'Deal stages and revenue-ready opportunities.',
  'revenue/analytics':        'Funnel metrics, conversion rates, and trends.',
  accounts:                   'Context, signals, people, and next actions by account.',
  'engine/autopilot':         'Automated sending rules and follow-up management.',
  'engine/sequences':         'Reusable outreach templates and guidance.',
  settings:                   'ICP, inboxes, credits, and integrations.',
}

const ALL_VIEWS: View[] = [
  'home',
  'sales/inbox', 'sales/outreach', 'sales/explore',
  'marketing/content', 'marketing/content/posts', 'marketing/content/blogs', 'marketing/content/videos',
  'marketing/campaigns', 'marketing/audience',
  'revenue/pipeline', 'revenue/analytics',
  'accounts',
  'engine/autopilot', 'engine/sequences',
  'settings',
]

interface Props {
  initialLeads: Lead[]
  userProfile: UserProfile
}

export default function DashboardShell({ initialLeads, userProfile }: Props) {
  const userTier = (userProfile.plan as SubscriptionTier) || 'free'

  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const requestedView = params.get('view')
      if (requestedView && (ALL_VIEWS as string[]).includes(requestedView)) {
        const v = requestedView as View
        return canAccessView(userTier, v) ? v : 'home'
      }
    }
    return 'home'
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

  function navigate(v: View) {
    if (!canAccessView(userTier, v)) return
    setActiveView(v)
    const url = new URL(window.location.href)
    url.searchParams.set('view', v)
    window.history.replaceState({}, '', url.toString())
  }

  return (
    <div className="flex min-h-screen relative">
      {/* Ambient background — matching landing page */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-x-0 top-0 h-[600px] opacity-[0.22]"
          style={{ background: 'radial-gradient(ellipse 70% 50% at 50% -5%, var(--color-ink-3), transparent)' }} />
        <div className="absolute inset-0 dot-grid opacity-[0.18]" />
      </div>

      <Sidebar
        companyName={userProfile.client_name || userProfile.company_name}
        userEmail={userProfile.email}
        activeView={activeView}
        onNavigate={navigate}
        workspaces={userProfile.workspaces ?? []}
        activeClientId={userProfile.active_client_id ?? null}
        userTier={userTier}
      />

      <div className="flex-1 min-w-0 flex flex-col relative z-10">
        {/* Top bar */}
        <header className="sticky top-0 z-20 h-16 border-b border-[var(--color-line-1)] bg-[var(--color-ink-1)]/80 backdrop-blur-xl">
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
                onClick={() => navigate('settings')}
                className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-white px-3 text-[12px] font-semibold text-[var(--color-text-2)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text-1)] transition-colors shadow-[0_1px_0_#0000000a]"
                title="Lead credit balance"
              >
                <span className="tabular-nums text-[var(--color-accent-ring)]">{leadCreditBalance}</span>
                <span>credits</span>
              </button>
              <button
                onClick={() => navigate('settings')}
                className="hidden sm:inline-flex h-9 px-3.5 rounded-full btn-primary text-[12.5px] font-semibold items-center gap-1.5 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                Add credits
              </button>
              <LogoutButton />
            </div>
          </div>
        </header>

        {/* View content */}
        <main className="flex-1 overflow-auto scroll-smooth px-6 py-8 pb-20">
          <div className="max-w-6xl mx-auto fade-in">
            {activeView === 'home' && <HomeView leads={initialLeads} onNavigate={navigate} />}
            {activeView === 'sales/inbox' && <InboxView leads={initialLeads} onNavigate={navigate} />}
            {activeView === 'sales/outreach' && <OutreachView leads={initialLeads} />}
            {activeView === 'sales/explore' && (
              <PlanGate userTier={userTier} requiredTier="growth" featureName="AI-Powered Lead Discovery">
                <ExploreView leads={initialLeads} />
              </PlanGate>
            )}
            {activeView === 'marketing/content' && (
              <PlanGate userTier={userTier} requiredTier="growth" featureName="Marketing Content Hub">
                <MarketingView hub="overview" />
              </PlanGate>
            )}
            {activeView === 'marketing/content/posts' && (
              <PlanGate userTier={userTier} requiredTier="growth" featureName="Marketing Content Hub">
                <MarketingView hub="posts" />
              </PlanGate>
            )}
            {activeView === 'marketing/content/blogs' && (
              <PlanGate userTier={userTier} requiredTier="growth" featureName="Marketing Content Hub">
                <MarketingView hub="blogs" />
              </PlanGate>
            )}
            {activeView === 'marketing/content/videos' && (
              <PlanGate userTier={userTier} requiredTier="growth" featureName="Marketing Content Hub">
                <MarketingView hub="videos" />
              </PlanGate>
            )}
            {activeView === 'marketing/campaigns' && (
              <PlanGate userTier={userTier} requiredTier="growth" featureName="Marketing Campaigns">
                <CampaignsView />
              </PlanGate>
            )}
            {activeView === 'marketing/audience' && (
              <PlanGate userTier={userTier} requiredTier="growth" featureName="Marketing Audience">
                <AudienceView leads={initialLeads} />
              </PlanGate>
            )}
            {activeView === 'revenue/pipeline' && <PipelineView leads={initialLeads} />}
            {activeView === 'revenue/analytics' && <AnalyticsView leads={initialLeads} />}
            {activeView === 'accounts' && <AccountsView />}
            {activeView === 'engine/autopilot' && (
              <PlanGate userTier={userTier} requiredTier="growth" featureName="Autopilot Engine">
                <AutopilotView leads={initialLeads} />
              </PlanGate>
            )}
            {activeView === 'engine/sequences' && <SequencesView />}
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
