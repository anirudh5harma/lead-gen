'use client'

import React from 'react'
import SpotlightCard from '@/components/landing/SpotlightCard'

export function Card({ children, className = '', spotlight = false }: { children: React.ReactNode; className?: string; spotlight?: boolean }) {
  if (spotlight) {
    return (
      <SpotlightCard className={`card ${className}`}>
        {children}
      </SpotlightCard>
    )
  }
  return (
    <div className={`card ${className}`}>{children}</div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">{children}</p>
  )
}

export function SectionHeader({ title, subtitle, label }: { title: string; subtitle?: string; label?: string }) {
  return (
    <div className="mb-6">
      {label && <SectionLabel>{label}</SectionLabel>}
      <h2 className={`text-2xl md:text-[32px] tracking-[-0.02em] text-[var(--color-text-1)] font-semibold leading-[1.1] ${label ? 'mt-3' : ''}`}>{title}</h2>
      {subtitle && <p className="mt-2 text-[14px] leading-[1.6] text-[var(--color-text-2)] max-w-xl">{subtitle}</p>}
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <div className="mx-auto mb-4 h-10 w-10 rounded-xl bg-[var(--color-ink-2)] flex items-center justify-center text-[var(--color-accent-ring)]">
        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[var(--color-text-1)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--color-text-4)] max-w-sm mx-auto">{body}</p>
    </div>
  )
}

export function PanelError({ title, message }: { title: string; message: string }) {
  return (
    <section className="card px-5 py-5">
      <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
      <p className="mt-2 text-xs text-[var(--color-sig-regulation)]">{message}</p>
    </section>
  )
}

export function TabLoadingState({ title, detail }: { title: string; detail: string }) {
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
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl border border-[var(--color-line-1)] bg-white" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
        <div className="h-80 animate-pulse rounded-2xl border border-[var(--color-line-1)] bg-white" />
        <div className="h-80 animate-pulse rounded-2xl border border-[var(--color-line-1)] bg-white" />
      </div>
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'blocked' || status === 'failed'
      ? 'bg-red-50 text-red-600'
      : status === 'completed' || status === 'sent' || status === 'booked'
        ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]'
        : status === 'waiting' || status === 'replied'
          ? 'bg-[#fff4df] text-[#936014]'
          : 'bg-[var(--color-ink-2)] text-[var(--color-text-2)]'
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {status}
    </span>
  )
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
