'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => { console.error(error) }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[var(--color-ink-1)]">
      <div className="text-center max-w-sm">
        <p className="mono mb-6 text-[var(--color-neg)]">Dashboard error</p>
        <h1 className="editorial-h2">
          Couldn&rsquo;t <span className="serif-italic text-[var(--color-accent)]">load.</span>
        </h1>
        <p className="text-[14px] text-[var(--color-text-3)] mt-4 leading-relaxed">
          Failed to load your dashboard. Try refreshing &mdash; if it persists, contact support.
        </p>
        <div className="mt-8 flex items-center justify-center gap-2">
          <button onClick={reset} className="btn-accent h-10 px-5 text-[13px]">
            Try again
          </button>
          <Link href="/" className="btn-ghost h-10 px-5 text-[13px] inline-flex items-center">
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
