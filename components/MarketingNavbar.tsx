'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function MarketingNavbar({ homeAnchors = false }: { homeAnchors?: boolean }) {
  const [loading, setLoading] = useState(false)

  async function signInWithGoogle() {
    setLoading(true)
    const supabase = createClient()
    const params = new URLSearchParams(window.location.search)
    const next = params.get('next')
    const callback = new URL('/auth/callback', window.location.origin)
    if (next?.startsWith('/') && !next.startsWith('//')) {
      callback.searchParams.set('next', next)
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) setLoading(false)
  }

  const howHref = homeAnchors ? '#how' : '/#how'
  const featuresHref = homeAnchors ? '#features' : '/#features'

  return (
    <nav className="relative z-10 border-b border-[var(--color-line-2)] bg-[var(--color-ink-2)]/88 backdrop-blur-md">
      <div className="w-full max-w-7xl mx-auto flex items-center justify-between px-6 md:px-8 h-16">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.svg"
              alt="Bombsell"
              width={28}
              height={28}
              className="shrink-0"
            />
            <span className="text-[15px] font-medium text-[var(--color-text-1)] tracking-tight">Bombsell</span>
          </Link>
          <div className="hidden md:flex items-center gap-6 text-[13px] font-medium text-[var(--color-text-2)]">
            <a href={howHref} className="hover:text-[var(--color-text-1)] transition-colors">Platform</a>
            <a href={featuresHref} className="hover:text-[var(--color-text-1)] transition-colors">Differentiation</a>
            <Link href="/pricing" className="hover:text-[var(--color-text-1)] transition-colors">Pricing</Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={signInWithGoogle}
            disabled={loading}
            className="h-9 px-4 rounded-full btn-primary text-[13px] disabled:opacity-60 inline-flex items-center gap-1.5 cursor-pointer"
          >
            {loading ? 'Redirecting…' : 'Sign in'} <span aria-hidden>→</span>
          </button>
        </div>
      </div>
    </nav>
  )
}
