'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import type { View } from './types'

interface SidebarProps {
  companyName: string
  userEmail?: string
  activeView: View
  onNavigate: (view: View) => void
}

const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
  {
    id: 'inbox',
    label: 'Work',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M22 6l-10 7L2 6" />
      </svg>
    ),
  },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h9l1 3h6v9h-7l-1-3H4" />
      </svg>
    ),
  },
  {
    id: 'accounts',
    label: 'Accounts',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 00-3-3.87" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    id: 'autopilot',
    label: 'Engine',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export default function Sidebar({ companyName, userEmail, activeView, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 768) setMobileOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const initial = (companyName || userEmail || 'U').charAt(0).toUpperCase()
  const widthClass = collapsed ? 'md:w-[68px]' : 'md:w-[220px]'

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

        <nav className="flex-1 px-2.5 pt-3 pb-2 space-y-0.5 overflow-y-auto">
          {NAV.map(item => {
            const active = activeView === item.id
            return (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); setMobileOpen(false) }}
                title={collapsed ? item.label : undefined}
                className={`
                  w-full flex items-center h-9 rounded-lg text-[13px] font-medium transition-colors
                  ${collapsed ? 'justify-center gap-0 px-0' : 'gap-2.5 px-2.5'}
                  ${active
                    ? 'bg-white text-[var(--color-text-1)] shadow-[0_1px_0_#0000000a,0_1px_2px_#0000000f]'
                    : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-ink-3)]'}
                `}
              >
                <span className={`shrink-0 ${active ? 'text-[var(--color-accent)]' : ''}`}>{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </button>
            )
          })}
        </nav>

        <div className="px-2.5 py-2.5 border-t border-[var(--color-line-1)] shrink-0">
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
