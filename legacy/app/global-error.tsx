'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export default function GlobalError({
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
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf8f5', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', maxWidth: 360, padding: '0 24px' }}>
          <div style={{ width: 48, height: 48, borderRadius: 16, background: '#fef2f0', border: '1px solid rgba(193,95,60,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="24" height="24" fill="none" stroke="#c15f3c" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1a1612', margin: '0 0 8px' }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: '#6b5f52', margin: '0 0 24px', lineHeight: 1.5 }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{ height: 36, padding: '0 16px', borderRadius: 100, background: '#c15f3c', color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer' }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{ height: 36, padding: '0 16px', borderRadius: 100, background: 'transparent', color: '#1a1612', border: '1px solid #e8e2d9', fontSize: 13, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
            >
              Go home
            </Link>
          </div>
        </div>
      </body>
    </html>
  )
}
