'use client'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import Image from 'next/image'
import MarketingNavbar from '@/components/MarketingNavbar'
import { useSectionReveal } from '@/hooks/use-section-reveal'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useSectionReveal()

  async function signInWithGoogle() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const params = new URLSearchParams(window.location.search)
    const next = params.get('next')
    const callback = new URL('/auth/callback', window.location.origin)
    if (next?.startsWith('/') && !next.startsWith('//')) {
      callback.searchParams.set('next', next)
    }
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (authError) { setError(authError.message); setLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden paper">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[linear-gradient(180deg,#fffaf2_0%,#faf9f5_62%,transparent_100%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 dot-grid opacity-35" />

      <MarketingNavbar homeAnchors />

      <main className="relative z-10 flex-1">
        <section className="section-reveal reveal-from-left w-full max-w-7xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-14 md:pb-20 grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-10 lg:gap-16 items-center">
          <div className="space-y-7 fade-in">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-2)] bg-white px-3 py-1 text-[11px] text-[var(--color-text-2)] shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] pulse-dot" />
              Built for modern GTM teams and their agents
            </div>

            <div className="space-y-5">
              <h1 className="max-w-[680px] text-[46px] md:text-[74px] leading-[0.96] tracking-[-0.02em] text-[var(--color-text-1)] font-medium">
                AI-native GTM Infrastructure
              </h1>
              <p className="max-w-[560px] text-[17px] leading-[1.6] text-[var(--color-text-2)]">
                Bombsell watches your market, keeps account context fresh, and turns high-intent moments into safe work for reps, operators, and AI agents.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={signInWithGoogle}
                disabled={loading}
                className="h-12 px-6 rounded-full btn-primary text-[14px] font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <GoogleIconSmall />
                )}
                {loading ? 'Redirecting...' : 'Start free'}
              </button>
              <a href="#platform" className="h-12 px-6 rounded-full btn-ghost text-[14px] flex items-center">
                See how it works
              </a>
            </div>

            {error && (
              <p className="max-w-sm rounded-lg border border-[var(--color-sig-regulation)]/20 bg-[var(--color-sig-regulation-bg)] px-3 py-2 text-xs text-[var(--color-sig-regulation)]">
                {error}
              </p>
            )}

            <div className="grid max-w-xl grid-cols-1 gap-2 text-[12px] text-[var(--color-text-3)] sm:grid-cols-3">
              {['Work inbox', 'Safe outbound', 'Agent-ready'].map(item => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <CheckMark /> {item}
                </span>
              ))}
            </div>
          </div>

          <ProductPreview />
        </section>

        <section className="section-reveal reveal-from-bottom border-y border-[var(--color-line-1)] bg-white/45">
          <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LOOP.map(item => (
              <div key={item.title} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-bg)] text-[12px] font-semibold text-[var(--color-accent-ring)]">
                  {item.step}
                </span>
                <div>
                  <p className="text-[13px] font-medium text-[var(--color-text-1)]">{item.title}</p>
                  <p className="text-[11.5px] text-[var(--color-text-4)]">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="platform" className="section-reveal reveal-from-bottom w-full max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28">
          <div className="mb-12 max-w-2xl">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-accent)]">What it does</p>
            <h2 className="text-4xl md:text-5xl tracking-[-0.02em] text-[var(--color-text-1)] font-medium leading-[1.05]">
              One unified workspace for everything your GTM agents handle.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {PLATFORM.map(item => (
              <div key={item.title} className="card p-6">
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-ink-2)] text-[var(--color-accent-ring)]">
                  {item.icon}
                </div>
                <h3 className="text-[17px] font-medium tracking-tight text-[var(--color-text-1)]">{item.title}</h3>
                <p className="mt-2 text-[13.5px] leading-6 text-[var(--color-text-2)]">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="section-reveal reveal-from-right border-y border-[var(--color-line-1)] bg-[var(--color-ink-2)]/45">
          <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28 grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-16 items-center">
            <div>
              <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-accent)]">Why it is different</p>
              <h2 className="max-w-xl text-4xl md:text-5xl tracking-[-0.02em] text-[var(--color-text-1)] font-medium leading-[1.05]">
                Built to be trusted before it is fully autonomous.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-7 text-[var(--color-text-2)]">
                Bombsell does not hide the work. You can see what changed, why an action is recommended, and what guardrails were applied before anything moves.
              </p>
            </div>

            <div className="grid gap-3">
              {DIFFERENTIATORS.map(item => (
                <div key={item.title} className="rounded-2xl border border-[var(--color-line-1)] bg-white px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                    <div>
                      <h3 className="text-[14px] font-medium text-[var(--color-text-1)]">{item.title}</h3>
                      <p className="mt-1 text-[13px] leading-6 text-[var(--color-text-2)]">{item.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section-reveal reveal-from-bottom w-full max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_0.75fr]">
            <div className="card p-8 md:p-10">
              <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-accent)]">Launch offer</p>
              <h2 className="max-w-2xl text-3xl md:text-5xl tracking-[-0.02em] text-[var(--color-text-1)] font-medium leading-[1.08]">
                Start with a self-serve workspace. Scale into managed GTM infrastructure.
              </h2>
              <p className="mt-5 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
                Connect an inbox, define your ICP, watch accounts, review agent work, and let Bombsell handle the repetitive GTM motion with guardrails.
              </p>
              <button
                onClick={signInWithGoogle}
                disabled={loading}
                className="mt-7 h-12 px-7 rounded-full btn-primary text-[14px] font-medium inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                <GoogleIconSmall /> Continue with Google
              </button>
            </div>

            <div className="card p-7 flex flex-col justify-between">
              <div>
                <p className="text-[13px] font-medium text-[var(--color-text-3)]">Self-serve</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight text-[var(--color-text-1)]">$0</span>
                  <span className="text-[12px] text-[var(--color-text-4)]">forever</span>
                </div>
                <div className="hairline my-5" />
                <ul className="space-y-2 text-[13px] text-[var(--color-text-2)]">
                  {['20 starter lead credits', 'Work inbox and account context', 'Gmail, CRM, Slack, and MCP access', 'Top up when you need more leads'].map(perk => (
                    <li key={perk} className="flex items-start gap-2">
                      <span className="mt-0.5 text-[var(--color-accent-ring)]">✓</span>
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Link href="/pricing" className="mt-7 h-10 rounded-full btn-ghost text-[13px] font-medium flex items-center justify-center">
                View pricing
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <LogoMark small />
            <span className="text-xs text-[var(--color-text-3)]">© {new Date().getFullYear()} Bombsell</span>
          </div>
          <div className="flex items-center gap-6 text-[12px] text-[var(--color-text-3)]">
            <Link href="/pricing" className="hover:text-[var(--color-text-1)] transition-colors">Pricing</Link>
            <Link href="/privacy" className="hover:text-[var(--color-text-1)] transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-[var(--color-text-1)] transition-colors">Terms</Link>
            <a href="mailto:team@bombsell.com" className="hover:text-[var(--color-text-1)] transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

const LOOP = [
  { step: '1', title: 'Find', body: 'Spot accounts in motion' },
  { step: '2', title: 'Understand', body: 'Keep context fresh' },
  { step: '3', title: 'Act', body: 'Move work safely' },
  { step: '4', title: 'Learn', body: 'Improve with outcomes' },
]

const PLATFORM = [
  {
    title: 'Know which accounts matter',
    body: 'Bombsell watches signals, watched accounts, and CRM context so your team sees the right accounts at the right moment.',
    icon: <IconRadar />,
  },
  {
    title: 'Turn context into work',
    body: 'Replies, approvals, follow-ups, CRM updates, and blocked actions land in one work inbox instead of scattered tools.',
    icon: <IconSpark />,
  },
  {
    title: 'Let agents operate safely',
    body: 'Connect inboxes and tools, then let agents help with GTM work under clear approvals, pacing, and suppression rules.',
    icon: <IconSend />,
  },
]

const DIFFERENTIATORS = [
  {
    title: 'A work inbox, not another feed',
    body: 'The product focuses attention on what needs action: approve, reply, recover, export, or let automation continue.',
  },
  {
    title: 'Clear guardrails for outbound',
    body: 'Verified contacts, unsubscribes, bounce checks, daily caps, spacing, and inbox rotation are part of the product.',
  },
  {
    title: 'Context your agents can use',
    body: 'Bombsell keeps GTM context accessible to your team, your tools, and AI agents through the app and MCP.',
  },
]

function ProductPreview() {
  return (
    <div className="relative fade-in">
      <div className="absolute -inset-4 -z-10 rounded-[32px] bg-[linear-gradient(135deg,#fff6ee,#f3e7d8)] opacity-80" />
      <div className="card overflow-hidden shadow-[0_28px_90px_-42px_#1d2b4f55]">
        <div className="flex items-center justify-between border-b border-[var(--color-line-1)] bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]/70" />
          </div>
          <span className="text-[11px] text-[var(--color-text-4)]">Work Inbox</span>
        </div>

        <div className="grid border-b border-[var(--color-line-1)] bg-[var(--color-ink-2)]/50 p-4 sm:grid-cols-3 gap-2">
          {[
            ['Open work', '18'],
            ['Replies', '7'],
            ['Booked', '3'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-[var(--color-line-1)] bg-white px-3 py-3">
              <p className="text-2xl font-semibold tracking-tight text-[var(--color-text-1)]">{value}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-4)]">{label}</p>
            </div>
          ))}
        </div>

        <div className="divide-y divide-[var(--color-line-1)]">
          {[
            { tag: 'Approve', company: 'Acme Robotics', body: 'Series B signal matched your ICP. Verified contact found.', tone: 'chip-funding' },
            { tag: 'Reply', company: 'Northwind Labs', body: 'Buyer asked for pricing and implementation timeline.', tone: 'chip-acquisition' },
            { tag: 'Blocked', company: 'TechFlow', body: 'Send paused by suppression policy. Needs review.', tone: 'chip-regulation' },
            { tag: 'Export', company: 'BuildBase', body: 'Account ready for CRM handoff with context attached.', tone: 'chip-expansion' },
          ].map(item => (
            <div key={item.company} className="flex items-start gap-3 px-4 py-4">
              <span className={`pill ${item.tone} shrink-0`}>{item.tag}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[var(--color-text-1)]">{item.company}</p>
                <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--color-text-3)]">{item.body}</p>
              </div>
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-line-1)] bg-[var(--color-ink-2)]/45 px-4 py-3">
          <p className="text-[11px] text-[var(--color-text-3)]">Context, guardrails, and next steps in one place.</p>
          <span className="rounded-full bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-medium text-white">Running</span>
        </div>
      </div>
    </div>
  )
}

function LogoMark({ small = false }: { small?: boolean }) {
  const size = small ? 26 : 32
  return (
    <Image
      src="/logo.svg"
      alt="Bombsell"
      width={size}
      height={size}
      className="shrink-0"
    />
  )
}

function GoogleIconSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="shrink-0">
      <path fill="#ffffff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" opacity="0.92"/>
      <path fill="#ffffff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" opacity="0.9"/>
      <path fill="#ffffff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" opacity="0.85"/>
      <path fill="#ffffff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

function CheckMark() {
  return (
    <svg className="w-3.5 h-3.5 text-[var(--color-accent-ring)]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function IconRadar() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" strokeOpacity="0.5" />
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    </svg>
  )
}

function IconSpark() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconSend() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12l16-8-6 18-2.5-7.5L4 12z" />
    </svg>
  )
}
