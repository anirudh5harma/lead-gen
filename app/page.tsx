'use client'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import Image from 'next/image'
import { useSectionReveal } from '@/hooks/use-section-reveal'
import HeroVisual from '@/components/landing/HeroVisual'
import MarqueeRow from '@/components/landing/MarqueeRow'
import AnimatedCounter from '@/components/landing/AnimatedCounter'
import SpotlightCard from '@/components/landing/SpotlightCard'
import GradientText from '@/components/landing/GradientText'

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
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: 'var(--color-ink-1)' }}>
      {/* Ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[720px] opacity-40"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, var(--color-ink-3), transparent)' }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 dot-grid opacity-30" />

      {/* Floating blobs */}
      <div aria-hidden className="blob blob-1 w-[500px] h-[500px] -top-20 -right-40 opacity-40" />
      <div aria-hidden className="blob blob-2 w-[400px] h-[400px] top-40 -left-20 opacity-30" />
      <div aria-hidden className="blob blob-3 w-[350px] h-[350px] top-[500px] right-[10%] opacity-25" />

      {/* Navbar */}
      <nav className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image src="/logo.svg" alt="Bombsell" width={28} height={28} className="shrink-0 transition-transform duration-300 group-hover:scale-110" />
          <span className="text-[15px] font-semibold tracking-tight text-[var(--color-text-1)]">Bombsell</span>
        </Link>
        <div className="flex items-center gap-6">
          <a href="#features" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[var(--color-accent)] hover:after:w-full after:transition-all after:duration-300">Features</a>
          <a href="#pricing" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[var(--color-accent)] hover:after:w-full after:transition-all after:duration-300">Pricing</a>
          <button
            onClick={signInWithGoogle}
            disabled={loading}
            className="h-9 px-4 rounded-full btn-primary text-[13px] font-medium disabled:opacity-60 flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform"
          >
            {loading ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <GoogleIconSmall />}
            {loading ? 'Signing in…' : 'Start free'}
          </button>
        </div>
      </nav>

      <main className="relative z-10 flex-1">
        {/* Hero */}
        <section className="section-reveal reveal-from-left w-full max-w-7xl mx-auto px-6 md:px-8 pt-12 md:pt-20 pb-16 md:pb-24 grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-12 lg:gap-20 items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-2)] bg-white px-3.5 py-1.5 text-[11.5px] text-[var(--color-text-2)] shadow-sm animate-float-slow">
              <span className="h-2 w-2 rounded-full bg-[var(--color-accent)] pulse-dot" />
              AI-native GTM Infra for lean teams.
            </div>

            <div className="space-y-5">
              <h1 className="max-w-[680px] text-[36px] md:text-[52px] leading-[0.98] tracking-[-0.03em] text-[var(--color-text-1)] font-semibold">
                AI GTM Infrastructure
                <br></br>for {" "}
                <GradientText as="span" className="font-serif italic">everyone</GradientText>
              </h1>
              <p className="max-w-[500px] text-[17px] leading-[1.65] text-[var(--color-text-2)]">
                Bombsell watches your market, reasons through live signals, and turns the right moments into pipeline without adding headcount.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 stagger-children">
              <button
                onClick={signInWithGoogle}
                disabled={loading}
                className="h-12 px-7 rounded-full btn-primary text-[14px] font-semibold disabled:opacity-60 flex items-center gap-2.5 cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <GoogleIconSmall />
                )}
                {loading ? 'Signing in…' : 'Start free with Google'}
              </button>
              <a href="#how-it-works" className="h-12 px-6 rounded-full btn-ghost text-[14px] font-medium flex items-center hover:scale-[1.02] active:scale-[0.98] transition-transform">
                See how it works
              </a>
            </div>

            {error && (
              <p className="max-w-sm rounded-xl border border-[var(--color-sig-regulation)]/15 bg-red-50/60 px-3.5 py-2.5 text-[12px] text-red-600">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-[var(--color-text-3)]">
              {['Finds live signals', 'Builds account context', 'Recommends the next move'].map(item => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <CheckMark /> {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative flex items-center justify-center min-h-[400px] md:min-h-[480px]">
            <HeroVisual />
          </div>
        </section>

        {/* Marquee trust bar */}
        <section className="border-y border-[var(--color-line-1)] bg-white/40 py-5">
          <MarqueeRow speed={35} pauseOnHover>
            {TRUST_ITEMS.map((item) => (
              <div key={item} className="flex items-center gap-2 text-[13px] text-[var(--color-text-3)] whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] opacity-60" />
                {item}
              </div>
            ))}
          </MarqueeRow>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="section-reveal reveal-from-bottom w-full max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28">
          <div className="mb-14 max-w-2xl">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">How it works</p>
            <h2 className="text-3xl md:text-[48px] tracking-[-0.02em] text-[var(--color-text-1)] font-semibold leading-[1.1]">
              Every target account becomes an{' '}
              <GradientText as="span" className="font-serif italic">active project.</GradientText>
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 stagger-children">
            {PLATFORM.map((item, i) => (
              <SpotlightCard key={item.title} className="card p-7 group hover:border-[var(--color-accent)]/20 transition-colors card-hover">
                <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-ink-2)] text-[var(--color-accent-ring)] group-hover:bg-[var(--color-accent-bg)] transition-colors duration-300">
                  {item.icon}
                </div>
                <div className="text-[11px] font-semibold text-[var(--color-accent-ring)] mb-2">Step {i + 1}</div>
                <h3 className="text-[17px] font-semibold tracking-tight text-[var(--color-text-1)]">{item.title}</h3>
                <p className="mt-2.5 text-[14px] leading-[1.6] text-[var(--color-text-2)]">{item.body}</p>
              </SpotlightCard>
            ))}
          </div>
        </section>

        {/* Differentiators */}
        <section className="section-reveal reveal-from-right border-y border-[var(--color-line-1)] bg-[var(--color-ink-2)]/35">
          <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28 grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] gap-14 lg:gap-20 items-start">
            <div className="lg:sticky lg:top-24">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Why Bombsell</p>
              <h2 className="max-w-md text-3xl md:text-[42px] tracking-[-0.02em] text-[var(--color-text-1)] font-semibold leading-[1.12]">
                A GTM system that remembers and{' '}
                <GradientText as="span" className="font-serif italic">improves.</GradientText>
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-[1.7] text-[var(--color-text-2)]">
                Most tools give you alerts. Bombsell keeps an account-level point of view, decides what matters, and helps your team act at the right time.
              </p>
            </div>

            <div className="grid gap-3 stagger-children">
              {DIFFERENTIATORS.map(item => (
                <SpotlightCard key={item.title} className="rounded-2xl border border-[var(--color-line-1)] bg-white px-6 py-5 card-hover transition-shadow duration-300">
                  <div className="flex items-start gap-4">
                    <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-accent)] animate-breathe" />
                    <div>
                      <h3 className="text-[14.5px] font-semibold text-[var(--color-text-1)]">{item.title}</h3>
                      <p className="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--color-text-2)]">{item.body}</p>
                    </div>
                  </div>
                </SpotlightCard>
              ))}
            </div>
          </div>
        </section>

        {/* Social proof / stats */}
        <section className="section-reveal reveal-from-bottom w-full max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: '50000', suffix: '+', label: 'Companies monitored' },
              { value: '24/7', suffix: '', label: 'Signal tracking' },
              { value: '1', suffix: ' person', label: 'GTM autopilot' },
              { value: '$0', suffix: '', label: 'To get started' },
            ].map(stat => (
              <div key={stat.label} className="group">
                <p className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--color-text-1)] group-hover:scale-105 transition-transform duration-300">
                  {stat.value === '24/7' || stat.value === '1' || stat.value === '0' ? (
                    <span>{stat.value}{stat.suffix}</span>
                  ) : (
                    <AnimatedCounter value={`${stat.value}${stat.suffix}`} />
                  )}
                </p>
                <p className="mt-1.5 text-[13px] text-[var(--color-text-3)]">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Testimonials marquee */}
        <section className="section-reveal reveal-from-bottom border-y border-[var(--color-line-1)] bg-white/30 py-16">
          <div className="w-full max-w-7xl mx-auto px-6 md:px-8 mb-10">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Testimonials</p>
            <h2 className="text-3xl md:text-[42px] tracking-[-0.02em] text-[var(--color-text-1)] font-semibold leading-[1.12]">
              Loved by{' '}
              <GradientText as="span" className="font-serif italic">founders</GradientText>, worldwide.
            </h2>
          </div>
          <MarqueeRow speed={50} pauseOnHover>
            {TESTIMONIALS.map((t) => (
              <div key={t.author} className="w-[320px] shrink-0 card p-5 card-hover">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[var(--color-accent-bg)] to-[var(--color-ink-3)] flex items-center justify-center text-[13px] font-semibold text-[var(--color-accent-ring)]">
                    {t.initials}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--color-text-1)]">{t.author}</p>
                    <p className="text-[11px] text-[var(--color-text-4)]">{t.role}</p>
                  </div>
                </div>
                <p className="text-[13px] leading-[1.65] text-[var(--color-text-2)]">&ldquo;{t.quote}&rdquo;</p>
              </div>
            ))}
          </MarqueeRow>
        </section>

        {/* Pricing / CTA */}
        <section id="pricing" className="section-reveal reveal-from-bottom w-full max-w-7xl mx-auto px-6 md:px-8 pb-20 md:pb-28 pt-20 md:pt-28">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_0.72fr]">
            <SpotlightCard className="card p-8 md:p-12 flex flex-col justify-center">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">Get started</p>
              <h2 className="max-w-xl text-3xl md:text-[44px] tracking-[-0.02em] text-[var(--color-text-1)] font-semibold leading-[1.1]">
                Run founder-led GTM with{' '}
                <GradientText as="span" className="font-serif italic">account agents.</GradientText>
              </h2>
              <p className="mt-5 max-w-lg text-[15px] leading-[1.7] text-[var(--color-text-2)]">
                Define your ICP, connect an inbox, and let Bombsell surface which accounts to work, why now, and what to do next.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  onClick={signInWithGoogle}
                  disabled={loading}
                  className="h-12 px-7 rounded-full btn-primary text-[14px] font-semibold inline-flex items-center gap-2.5 disabled:opacity-60 cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform"
                >
                  <GoogleIconSmall /> Start free with Google
                </button>
                <Link href="/pricing" className="h-12 px-6 rounded-full btn-ghost text-[14px] font-medium flex items-center hover:scale-[1.02] active:scale-[0.98] transition-transform">
                  View pricing
                </Link>
              </div>
            </SpotlightCard>

            <div className="card p-8 flex flex-col justify-between card-hover">
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-text-3)]">Self-serve</p>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tracking-tight text-[var(--color-text-1)]">$0</span>
                  <span className="text-[13px] text-[var(--color-text-4)]">forever</span>
                </div>
                <div className="hairline my-6" />
                <ul className="space-y-3 text-[13.5px] text-[var(--color-text-2)]">
                  {['20 starter lead credits', 'Account agents', 'Signal monitoring', 'Verified contact enrichment', 'Approve-first sending', 'Outcome learning'].map(perk => (
                    <li key={perk} className="flex items-start gap-2.5">
                      <span className="mt-0.5 text-[var(--color-accent-ring)]">✓</span>
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={signInWithGoogle}
                disabled={loading}
                className="mt-8 h-11 rounded-full btn-primary text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                {loading ? 'Signing in…' : 'Get started'}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="Bombsell" width={24} height={24} className="shrink-0" />
            <span className="text-[12px] text-[var(--color-text-3)]">© {new Date().getFullYear()} Bombsell</span>
          </div>
          <div className="flex items-center gap-6 text-[12.5px] text-[var(--color-text-3)]">
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

const TRUST_ITEMS = [
  'No credit card required',
  'Free forever plan',
  'Autonomous 24/7',
  'GDPR ready',
  'Used by 50+ founders',
  'Real-time signals',
  'Hyper-personalized outreach',
  'Built for lean teams',
]

const PLATFORM = [
  {
    title: 'Spot account movement',
    body: 'Funding, hiring, expansion, product shifts, and market events are normalized into account-level context.',
    icon: <IconRadar />,
  },
  {
    title: 'Reason from your ICP',
    body: 'Each account agent keeps a point of view on fit, urgency, likely buyers, and the most useful next step.',
    icon: <IconSpark />,
  },
  {
    title: 'Move pipeline forward',
    body: 'Bombsell can prepare personalized outreach, enforce safety checks, rotate inboxes, and learn from every outcome.',
    icon: <IconSend />,
  },
]

const DIFFERENTIATORS = [
  {
    title: 'Built for lean GTM teams',
    body: 'Founder-led teams get the account research, prioritization, and execution discipline of a larger revenue team without hiring one.',
  },
  {
    title: 'Per-account memory',
    body: 'Signals, people, touchpoints, objections, and outcomes stay attached to the account so the next action starts with context.',
  },
  {
    title: 'Execution with guardrails',
    body: 'Verified contacts only, unsubscribe handling, bounce suppression, inbox rotation, and daily send caps keep your domain reputation clean.',
  },
]

const TESTIMONIALS = [
  {
    initials: 'JS',
    author: 'Jordan S.',
    role: 'Founder, Series A SaaS',
    quote: 'Bombsell surfaced 3 accounts we had completely missed. One turned into a $40k deal within two weeks.',
  },
  {
    initials: 'MK',
    author: 'Maya K.',
    role: 'Head of Growth',
    quote: 'The account agents feel like having a researcher who never sleeps. Our reply rates 3x\'d in a month.',
  },
  {
    initials: 'DL',
    author: 'David L.',
    role: 'Solo Founder',
    quote: 'I went from zero outbound to 50 personalized touches a day without hiring. Game changer.',
  },
  {
    initials: 'AR',
    author: 'Aisha R.',
    role: 'VP Sales',
    quote: 'Finally, a tool that understands context. Not just who to email, but why now and what to say.',
  },
  {
    initials: 'TW',
    author: 'Tom W.',
    role: 'Founder, B2B Marketplace',
    quote: 'The guardrails saved our domain reputation. We can scale aggressively without worrying about spam filters.',
  },
]

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
