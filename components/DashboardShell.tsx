'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Lead } from '@/lib/leads'
import type { View, UserProfile } from './dashboard/types'
import type { SubscriptionTier } from '@/lib/lead-credits'
import Icon from '@/components/Icon'
import HomeView from './dashboard/HomeView'
import AccountsView from './dashboard/AccountsView'
import OutreachView from './dashboard/OutreachView'
import AgentsView from './dashboard/AgentsView'
import IntegrationsView from './dashboard/IntegrationsView'
import SettingsView from './dashboard/SettingsView'
import ContentView from './dashboard/ContentView'

interface Props {
  initialLeads: Lead[]
  userProfile: UserProfile
}

type NavEntry = { id: View; label: string; sub: string; icon: string; group?: string }

const VIEWS: NavEntry[] = [
  { id: 'home',         label: 'Home',         sub: 'Today’s queue and command bar.',                          icon: 'sync_alt' },
  { id: 'outreach',     label: 'Pipeline',     sub: 'Outbound — priority leads, drafts, sent, replies.',       icon: 'mail',    group: 'Outbound' },
  { id: 'accounts',     label: 'Signals',      sub: 'Outbound — accounts, signals, fit scores.',               icon: 'sensors', group: 'Outbound' },
  { id: 'content',      label: 'Content',      sub: 'Content engine — ideas, composer, calendar, performance.', icon: 'edit_note', group: 'Content' },
  { id: 'agents',       label: 'Agents',       sub: 'Agent stacks, fleet, pipelines, and live activity.',      icon: 'smart_toy', group: 'System' },
  { id: 'integrations', label: 'Integrations', sub: 'Sending, social, CRM, signals — all in one place.',       icon: 'hub',     group: 'System' },
  { id: 'settings',     label: 'Settings',     sub: 'Profile, billing, team, and preferences.',                icon: 'settings', group: 'System' },
]

const VALID_VIEWS = new Set(VIEWS.map(v => v.id))

function normalizeView(input: string | null): View {
  if (!input) return 'home'
  if (VALID_VIEWS.has(input as View)) return input as View
  if (input.startsWith('sales/')) return input.endsWith('outreach') ? 'outreach' : 'home'
  if (input.startsWith('marketing/') || input.startsWith('content/')) return 'content'
  if (input.startsWith('revenue/')) return 'accounts'
  if (input.startsWith('engine/')) return 'agents'
  return 'home'
}

export default function DashboardShell({ initialLeads, userProfile }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window === 'undefined') return 'home'
    return normalizeView(new URLSearchParams(window.location.search).get('view'))
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const userTier = useMemo<SubscriptionTier>(() => {
    const plan = (userProfile.plan ?? 'free') as SubscriptionTier
    return ['free', 'launch', 'team', 'growth', 'scale', 'enterprise'].includes(plan) ? plan : 'free'
  }, [userProfile.plan])

  useEffect(() => {
    function onPopState() {
      setActiveView(normalizeView(new URLSearchParams(window.location.search).get('view')))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (mobileNavOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [mobileNavOpen])

  function navigate(v: View) {
    setActiveView(v)
    setMobileNavOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.set('view', v)
    window.history.replaceState({}, '', url.toString())
  }

  function refresh() { startTransition(() => router.refresh()) }

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const titleMeta = VIEWS.find(v => v.id === activeView) ?? VIEWS[0]
  const credits = userProfile.lead_credit_balance ?? 0

  return (
    <div className="min-h-screen flex bg-surface font-body-main text-on-surface">
      {/* Desktop sidebar */}
      <Sidebar profile={userProfile} activeView={activeView} onNavigate={navigate} />

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-on-surface/40 md:hidden" onClick={() => setMobileNavOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-64 md:hidden">
            <Sidebar profile={userProfile} activeView={activeView} onNavigate={navigate} forceShow />
          </div>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col md:pl-64">
        <TopBar
          subtitle={titleMeta.sub}
          onRefresh={refresh}
          onMenu={() => setMobileNavOpen(true)}
          onLogout={() => void logout()}
          credits={credits}
        />

        <main className="flex-1">
          <div className="max-w-[1280px] mx-auto px-margin-page py-stack-lg">
            {activeView === 'home'         && <HomeView profile={userProfile} leads={initialLeads} onNavigate={navigate} />}
            {activeView === 'accounts'     && <AccountsView profile={userProfile} leads={initialLeads} />}
            {activeView === 'outreach'     && <OutreachView profile={userProfile} leads={initialLeads} />}
            {activeView === 'content'      && <ContentView profile={userProfile} />}
            {activeView === 'agents'       && <AgentsView profile={userProfile} />}
            {activeView === 'integrations' && <IntegrationsView profile={userProfile} />}
            {activeView === 'settings'     && <SettingsView profile={userProfile} userTier={userTier} />}
          </div>
        </main>
      </div>
    </div>
  )
}

/* ─── Sidebar ─────────────────────────────────────────────────── */

function Sidebar({
  profile, activeView, onNavigate, forceShow,
}: {
  profile: UserProfile; activeView: View; onNavigate: (v: View) => void; forceShow?: boolean;
}) {
  const initials = (profile.client_name || profile.company_name || 'BS')
    .split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <aside className={`${forceShow ? 'flex w-full h-full' : 'hidden md:flex w-64 fixed left-0 top-0 h-screen'} flex-col bg-surface-container-lowest hairline-r z-50`}>
      <div className="px-6 py-10">
        <h1 className="font-bold text-[20px] tracking-tight text-primary leading-none">Bombsell</h1>
        <p className="font-label-mono text-[9px] uppercase tracking-[0.18em] text-on-surface-variant mt-1">Agentic GTM</p>
      </div>

      {profile.workspaces && profile.workspaces.length > 0 && (
        <div className="px-4 mb-3">
          <label className="font-label-mono text-[9px] uppercase tracking-widest text-outline-variant px-1">Workspace</label>
          <select
            value={profile.active_client_id ?? ''}
            onChange={async (e) => {
              const id = e.target.value
              if (!id) return
              await fetch('/api/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeClientId: id }) })
              window.location.reload()
            }}
            className="mt-1 w-full font-label-mono text-[11px] uppercase bg-surface-container border border-outline-variant/40 rounded px-2 py-1.5"
          >
            {!profile.active_client_id && <option value="">Personal</option>}
            {profile.workspaces.map((w) => <option key={w.client_id} value={w.client_id}>{w.name} · {w.role}</option>)}
          </select>
        </div>
      )}

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {VIEWS.map((v, i) => {
          const active = activeView === v.id
          const showGroup = v.group && v.group !== VIEWS[i - 1]?.group
          return (
            <div key={v.id}>
              {showGroup && <p className="px-3 pt-4 pb-1 font-label-mono text-[9px] uppercase tracking-widest text-outline-variant">{v.group}</p>}
              <button
                onClick={() => onNavigate(v.id)}
                className={`group w-full flex items-center gap-3 px-3 py-2 rounded transition-colors font-label-mono text-label-mono uppercase tracking-wider ${
                  active
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                <Icon name={v.icon} size={20} fill={active} />
                <span>{v.label}</span>
              </button>
            </div>
          )
        })}
      </nav>

      <div className="mt-auto">
        <button
          onClick={() => onNavigate('settings')}
          className="mx-4 mb-6 w-[calc(100%-2rem)] p-3 bg-surface-container rounded-lg hairline-border flex items-center justify-between group hover:bg-surface-container-high transition-colors text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded bg-primary text-on-primary flex items-center justify-center font-bold text-xs shrink-0">{initials}</div>
            <div className="flex flex-col min-w-0">
              <p className="font-label-mono text-[10px] text-on-surface uppercase truncate leading-tight">{profile.client_name || profile.company_name}</p>
              <p className="font-label-mono text-[9px] text-primary uppercase leading-tight">{profile.plan ?? 'free'} plan</p>
            </div>
          </div>
          <Icon name="settings" size={18} className="text-on-surface-variant group-hover:text-primary transition-colors shrink-0" />
        </button>
      </div>
    </aside>
  )
}

/* ─── Top bar ─────────────────────────────────────────────────── */

function TopBar({
  subtitle, onRefresh, onMenu, onLogout, credits,
}: {
  subtitle: string; onRefresh: () => void; onMenu: () => void; onLogout: () => void; credits: number;
}) {
  return (
    <header className="sticky top-0 z-40 h-14 bg-surface-container-low/80 backdrop-blur-md hairline-b flex items-center justify-between px-margin-page">
      <div className="flex items-center gap-stack-md min-w-0">
        <button
          onClick={onMenu}
          className="md:hidden -ml-2 h-9 w-9 inline-flex items-center justify-center rounded text-on-surface-variant hover:bg-surface-container"
          aria-label="Open menu"
        >
          <Icon name="menu" size={20} />
        </button>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
          <span className="font-label-mono text-label-mono uppercase text-on-surface">Fleet live</span>
        </div>
        <div className="hidden sm:block h-4 w-px bg-outline-variant" />
        <span className="hidden sm:block font-label-mono text-[10px] uppercase text-on-surface-variant tracking-wider truncate">{subtitle}</span>
      </div>
      <div className="flex items-center gap-stack-lg shrink-0">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-lowest hairline-border rounded-full">
          <Icon name="database" size={16} className="text-primary" />
          <span className="font-label-mono text-[10px] uppercase text-on-surface">Credits: {credits}</span>
        </div>
        <button
          onClick={onRefresh}
          className="h-8 w-8 inline-flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
          title="Refresh" aria-label="Refresh"
        >
          <Icon name="refresh" size={18} />
        </button>
        <button onClick={onLogout} className="font-label-mono text-label-mono uppercase text-on-surface-variant hover:text-primary transition-colors">Logout</button>
      </div>
    </header>
  )
}
