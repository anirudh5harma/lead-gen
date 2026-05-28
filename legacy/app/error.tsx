'use client'

import { useEffect } from 'react'

export default function ErrorBoundary({
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
        <p className="mono mb-6 text-[var(--color-neg)]">Error</p>
        <h1 className="editorial-h2">
          Something <span className="serif-italic text-[var(--color-accent)]">broke.</span>
        </h1>
        <p className="text-[14px] text-[var(--color-text-3)] mt-4 leading-relaxed">
          {process.env.NODE_ENV === 'development' && error.message
            ? error.message
            : 'An unexpected error occurred. Try again or head home.'}
        </p>
        <div className="mt-8 flex items-center justify-center gap-2">
          <button onClick={reset} className="btn-accent h-10 px-5 text-[13px]">
            Try again
          </button>
          <a href="/dashboard" className="btn-ghost h-10 px-5 text-[13px] inline-flex items-center">
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
