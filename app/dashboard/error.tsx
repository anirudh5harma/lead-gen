'use client'

import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[var(--color-ink-1)] relative overflow-hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 dot-grid opacity-50" />
      <div className="relative text-center space-y-5 max-w-sm fade-in">
        <div className="w-12 h-12 rounded-2xl bg-[var(--color-sig-regulation-bg)] border border-[var(--color-sig-regulation)]/20 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-[var(--color-sig-regulation)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-medium tracking-tight text-[var(--color-text-1)]">Dashboard error</h2>
          <p className="text-xs text-[var(--color-text-3)] leading-relaxed">
            Failed to load your dashboard. Try refreshing — if it persists, contact support.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={reset}
            className="h-9 px-4 rounded-full btn-primary text-xs"
          >
            Try again
          </button>
          <a
            href="/"
            className="h-9 px-4 rounded-full btn-ghost text-xs inline-flex items-center"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  )
}
