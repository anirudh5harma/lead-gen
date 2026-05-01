'use client'

import React from 'react'

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>{children}</div>
  )
}

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-4 border-b border-[var(--color-line-1)]">
      <h2 className="text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
      {subtitle && <p className="mt-1 text-xs text-[var(--color-text-4)]">{subtitle}</p>}
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--color-text-4)]">{body}</p>
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
