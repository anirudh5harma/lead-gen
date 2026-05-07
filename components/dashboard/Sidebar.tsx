'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import type { View, NavSection, WorkspaceMembership } from './types'
import type { SubscriptionTier } from '@/lib/lead-credits'
import { canAccessView } from '@/lib/plan-access'

interface SidebarProps {
  companyName: string
  userEmail?: string
  activeView: View
  onNavigate: (view: View) => void
  workspaces: WorkspaceMembership[]
  activeClientId: string | null
  userTier: SubscriptionTier
}

const SECTIONS: NavSection[] = [
  {
    id: 'sales', label: 'Sales',
    items: [
      { id: 'sales/inbox', label: 'Work Inbox' },
      { id: 'sales/explore', label: 'Explore' },
      { id: 'sales/outreach', label: 'Outreach' },
    ],
  },
  {
    id: 'marketing', label: 'Marketing',
    items: [
      {
        id: 'marketing/content',
        label: 'Content Hub',
        children: [
          { id: 'marketing/content', label: 'Overview' },
          { id: 'marketing/content/posts', label: 'Posts' },
          { id: 'marketing/content/blogs', label: 'Blogs' },
          { id: 'marketing/content/videos', label: 'Videos' },
        ],
      },
      { id: 'marketing/campaigns', label: 'Campaigns' },
      { id: 'marketing/audience', label: 'Audience' },
    ],
  },
  {
    id: 'revenue', label: 'Revenue',
    items: [
      { id: 'revenue/pipeline', label: 'Pipeline' },
      { id: 'revenue/analytics', label: 'Analytics' },
    ],
  },
  {
    id: 'engine', label: 'Engine',
    items: [
      { id: 'engine/autopilot', label: 'Autopilot' },
      { id: 'engine/coverage', label: 'Coverage' },
      { id: 'engine/sequences', label: 'Sequences' },
    ],
  },
]

const TOP_ITEMS: Array<{ id: View; label: string }> = [
  { id: 'home', label: 'Home' },
]

const BOTTOM_ITEMS: Array<{ id: View; label: string }> = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'settings', label: 'Settings' },
]

function getViewIcon(view: View): React.ReactNode {
  switch (view) {
    case 'home':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
    case 'sales/inbox':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><path strokeLinecap="round" strokeLinejoin="round" d="M22 6l-10 7L2 6" /></svg>
    case 'sales/outreach':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
    case 'sales/explore':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><circle cx="11" cy="11" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" /></svg>
    case 'marketing/content':
    case 'marketing/content/posts':
    case 'marketing/content/blogs':
    case 'marketing/content/videos':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5" /><path strokeLinecap="round" strokeLinejoin="round" d="M4 5h9l1 3h6v9h-7l-1-3H4" /></svg>
    case 'marketing/campaigns':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
    case 'marketing/audience':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 00-3-3.87" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 010 7.75" /></svg>
    case 'revenue/pipeline':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
    case 'revenue/analytics':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" /><path strokeLinecap="round" strokeLinejoin="round" d="M7 15l3-3 3 2 5-7" /><path strokeLinecap="round" strokeLinejoin="round" d="M18 7h-4" /></svg>
    case 'accounts':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 00-3-3.87" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 010 7.75" /></svg>
    case 'engine/autopilot':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2a10 10 0 100 20 10 10 0 000-20z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" /></svg>
    case 'engine/coverage':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    case 'engine/sequences':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
    case 'settings':
      return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
  }
}

export default function Sidebar({ companyName, userEmail, activeView, onNavigate, workspaces, activeClientId, userTier }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['sales']))
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false)

  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 768) setMobileOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const parentSection = SECTIONS.find(s => activeView.startsWith(s.id + '/'))
    if (parentSection) {
      setOpenSections(prev => {
        if (prev.has(parentSection.id)) return prev
        return new Set(prev).add(parentSection.id)
      })
    }
  }, [activeView])

  function toggleSection(sectionId: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const initial = (companyName || userEmail || 'U').charAt(0).toUpperCase()
  const widthClass = collapsed ? 'md:w-[68px]' : 'md:w-[220px]'

  const hasMultipleWorkspaces = workspaces.length > 0

  async function switchWorkspace(clientId: string) {
    if (clientId === activeClientId) {
      setWorkspaceMenuOpen(false)
      return
    }
    setSwitchingWorkspace(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeClientId: clientId }),
      })
      if (res.ok) {
        window.location.reload()
      }
    } catch {
      // ignore
    } finally {
      setSwitchingWorkspace(false)
      setWorkspaceMenuOpen(false)
    }
  }

  function navItemClass(active: boolean, compact = false) {
    if (compact) {
      return `w-full flex items-center justify-center h-9 rounded-lg text-[13px] font-medium transition-all duration-200 ${active ? 'bg-white text-[var(--color-accent)] shadow-[0_1px_0_#0000000a,0_1px_2px_#0000000f]' : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-ink-3)]'}`
    }
    return `w-full flex items-center h-9 rounded-lg text-[13px] font-medium transition-all duration-200 gap-2.5 px-2.5 ${active ? 'bg-white text-[var(--color-accent)] shadow-[0_1px_0_#0000000a,0_1px_2px_#0000000f]' : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-ink-3)]'}`
  }

  return (
    <>
      <button
        aria-label="Open menu"
        onClick={() => setMobileOpen(o => !o)}
        className="md:hidden fixed top-3.5 left-4 z-40 w-9 h-9 rounded-lg bg-white border border-[var(--color-line-2)] flex items-center justify-center text-[var(--color-text-2)] shadow-sm"
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
        </svg>
      </button>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-30" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`
        fixed md:sticky top-0 left-0 h-screen z-40
        ${widthClass}
        ${mobileOpen ? 'w-[220px] translate-x-0' : '-translate-x-full md:translate-x-0'}
        transition-all duration-200 ease-out
        bg-[var(--color-ink-2)] border-r border-[var(--color-line-1)]
        flex flex-col
      `}>
        <div className="h-16 px-3 flex items-center justify-between border-b border-[var(--color-line-1)] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pl-1">
            <Image src="/logo.svg" alt="Bombsell" width={28} height={28} className="shrink-0" />
            {!collapsed && (
              <span className="text-[15px] font-semibold text-[var(--color-text-1)] tracking-tight truncate">Bombsell</span>
            )}
          </div>
          <button
            onClick={() => setCollapsed(c => !c)}
            className="hidden md:flex items-center justify-center w-7 h-7 text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-ink-3)] rounded-md transition-colors shrink-0"
            aria-label="Toggle sidebar"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={collapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
            </svg>
          </button>
        </div>

        <nav className="flex-1 px-2.5 pt-3 pb-2 overflow-y-auto space-y-0.5">
          {!collapsed ? (
            <>
              {TOP_ITEMS.map(item => {
                const active = activeView === item.id
                return (
                  <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false) }} className={navItemClass(active)}>
                    <span className={`shrink-0 ${active ? 'text-[var(--color-accent)]' : ''}`}>{getViewIcon(item.id)}</span>
                    <span>{item.label}</span>
                  </button>
                )
              })}

              <div className="h-3" />

              {SECTIONS.map(section => {
                const sectionOpen = openSections.has(section.id)
                return (
                  <div key={section.id}>
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="w-full flex items-center h-8 rounded-md text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-4)] hover:text-[var(--color-text-2)] transition-colors gap-1.5 px-1.5"
                    >
                      <svg
                        width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}
                        className={`transition-transform duration-150 ${sectionOpen ? 'rotate-90' : ''}`}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      {section.label}
                    </button>

                    {sectionOpen && (
                      <div className="space-y-0.5 mt-0.5 mb-1.5">
                        {section.items.map(item => {
                          const active = activeView === item.id || Boolean(item.children?.some(child => child.id === activeView))
                          const locked = !canAccessView(userTier, item.id)
                          return (
                            <div key={item.id}>
                              <button
                                onClick={() => { onNavigate(item.id); setMobileOpen(false) }}
                                className={`${navItemClass(active)} pl-5 pr-2.5 ${locked ? 'opacity-60' : ''}`}
                                title={locked ? `${item.label} — Upgrade to Growth` : item.label}
                              >
                                <span className={`shrink-0 ${active ? 'text-[var(--color-accent)]' : ''}`}>{getViewIcon(item.id)}</span>
                                <span>{item.label}</span>
                                {locked && (
                                  <span className="ml-auto text-[var(--color-text-4)]">
                                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                      <path d="M7 11V7a5 5 0 0110 0v4" />
                                    </svg>
                                  </span>
                                )}
                              </button>
                              {item.children && active && (
                                <div className="ml-7 mt-0.5 space-y-0.5 border-l border-[var(--color-line-1)] pl-2">
                                  {item.children.map(child => {
                                    const childActive = activeView === child.id
                                    return (
                                      <button
                                        key={child.id}
                                        onClick={() => { onNavigate(child.id); setMobileOpen(false) }}
                                        className={`w-full flex h-7 items-center rounded-md px-2 text-left text-[12px] font-medium transition-colors ${
                                          childActive
                                            ? 'bg-white text-[var(--color-accent)] shadow-[0_1px_0_#0000000a,0_1px_2px_#0000000f]'
                                            : 'text-[var(--color-text-3)] hover:bg-[var(--color-ink-3)] hover:text-[var(--color-text-1)]'
                                        }`}
                                      >
                                        {child.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="h-3" />

              {BOTTOM_ITEMS.map(item => {
                const active = activeView === item.id
                return (
                  <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false) }} className={navItemClass(active)}>
                    <span className={`shrink-0 ${active ? 'text-[var(--color-accent)]' : ''}`}>{getViewIcon(item.id)}</span>
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </>
          ) : (
            <>
              {TOP_ITEMS.map(item => {
                const active = activeView === item.id
                return (
                  <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false) }} title={item.label} className={navItemClass(active, true)}>
                    <span className={`shrink-0 ${active ? 'text-[var(--color-accent)]' : ''}`}>{getViewIcon(item.id)}</span>
                  </button>
                )
              })}

              <div className="h-1.5" />

              {SECTIONS.map(section =>
                section.items.flatMap(item => [item, ...(item.children ?? [])]).map(item => {
                  const active = activeView === item.id
                  const locked = !canAccessView(userTier, item.id)
                  return (
                    <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false) }} title={locked ? `${item.label} — Upgrade to Growth` : item.label} className={`${navItemClass(active, true)} ${locked ? 'opacity-60' : ''}`}>
                      <span className={`shrink-0 ${active ? 'text-[var(--color-accent)]' : ''}`}>{getViewIcon(item.id)}</span>
                    </button>
                  )
                })
              )}

              <div className="h-1.5" />

              {BOTTOM_ITEMS.map(item => {
                const active = activeView === item.id
                return (
                  <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false) }} title={item.label} className={navItemClass(active, true)}>
                    <span className={`shrink-0 ${active ? 'text-[var(--color-accent)]' : ''}`}>{getViewIcon(item.id)}</span>
                  </button>
                )
              })}
            </>
          )}
        </nav>

        <div className="px-2.5 py-2.5 border-t border-[var(--color-line-1)] shrink-0">
          {!collapsed && hasMultipleWorkspaces && (
            <div className="relative mb-2">
              <button
                onClick={() => setWorkspaceMenuOpen(o => !o)}
                disabled={switchingWorkspace}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--color-ink-3)] transition-colors"
              >
                <div className="w-5 h-5 shrink-0 rounded-full bg-gradient-to-br from-[var(--color-accent-hi)] to-[var(--color-accent)] flex items-center justify-center text-[9px] font-bold text-white">
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11.5px] font-semibold text-[var(--color-text-1)] truncate leading-snug">{companyName || 'Your company'}</p>
                </div>
                <svg className={`w-3 h-3 text-[var(--color-text-3)] shrink-0 transition-transform ${workspaceMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {workspaceMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setWorkspaceMenuOpen(false)} />
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-[var(--color-line-1)] rounded-xl shadow-lg z-40 py-1 max-h-48 overflow-y-auto">
                    {workspaces.map(ws => (
                      <button
                        key={ws.client_id}
                        onClick={() => switchWorkspace(ws.client_id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors ${
                          ws.client_id === activeClientId
                            ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] font-medium'
                            : 'text-[var(--color-text-1)] hover:bg-[var(--color-ink-2)]'
                        }`}
                      >
                        <span className="truncate flex-1">{ws.name}</span>
                        {ws.client_id === activeClientId && (
                          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className={`flex items-center gap-2.5 rounded-lg px-2 h-10 hover:bg-[var(--color-ink-3)] transition-colors cursor-default ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-[var(--color-accent-hi)] to-[var(--color-accent)] flex items-center justify-center text-[11px] font-bold text-white">
              {initial}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-[var(--color-text-1)] truncate leading-snug">{companyName || 'Your company'}</p>
                <p className="text-[10.5px] text-[var(--color-text-3)] truncate leading-snug">{userEmail || 'Signed in'}</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
