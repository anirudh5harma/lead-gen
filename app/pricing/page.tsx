'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useSectionReveal } from '@/hooks/use-section-reveal'

const PLANS = [
  {
    id: 'free' as const,
    name: 'Launch',
    price: '$0',
    period: 'forever',
    description: 'Getting started.',
    features: [
      '10 starter lead credits',
      'Account agents and Work Inbox',
      'Live Signal monitoring',
      'Gmail and Outlook connectors',
      'Reply and outcome learning',
    ],
    cta: 'Get started',
    highlight: false,
  },
  {
    id: 'growth' as const,
    name: 'Growth',
    price: '$49',
    period: '/mo',
    annualPrice: '$490',
    annualPeriod: '/yr',
    description: 'Founders and growing teams.',
    features: [
      '60 lead unlocks/month',
      'Autopilot Engine',
      'AI-Powered Lead Discovery',
      'Marketing content, calendar and integrations',
      '3 connected inboxes',
      'PAYG overages at $0.65/lead',
      'Everything in Launch'
    ],
    cta: 'Start Growth',
    highlight: false,
  },
  {
    id: 'scale' as const,
    name: 'Scale',
    price: '$99',
    period: '/mo',
    annualPrice: '$990',
    annualPeriod: '/yr',
    description: 'Volume, depth and team controls.',
    features: [
      '200 lead unlocks/month',
      'Team features + shared memory',
      'Custom outreach templates',
      '10 connected inboxes',
      'CRM sync and Slack alerts',
      'PAYG overages at $0.50/lead',
      'Everything in Growth'
    ],
    cta: 'Start Scale',
    highlight: true,
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'SMBs with custom needs.',
    features: [
      'Unlimited lead unlocks',
      'Unlimited inboxes',
      'Custom playbooks',
      'Security review and audit controls',
      'Priority support',
    ],
    cta: 'Talk to us',
    highlight: false,
    href: 'mailto:team@bombsell.com?subject=Enterprise%20Plan%20Inquiry',
  },
]

const PAYG_PACKS = [
  { amount: 20, credits: 25, label: 'Plus' },
  { amount: 50, credits: 75, label: 'Pro' },
  { amount: 100, credits: 200, label: 'Max' },
]

const FAQS = [
  {
    q: 'What do credits pay for?',
    a: 'Credits are used when Bombsell unlocks a lead/contact. Monitoring accounts, reviewing work items, connecting inboxes, and managing settings do not consume credits. Subscription plans include a monthly allocation of lead unlocks.',
  },
  {
    q: 'What happens when I run out of subscription leads?',
    a: 'You can either upgrade your plan or purchase PAYG credits. Growth overages are $0.65/lead; Scale overages are $0.50/lead. Free users must purchase credits to continue unlocking.',
  },
  {
    q: 'Can I cancel or change my plan anytime?',
    a: 'Yes. You can upgrade, downgrade, or cancel from your Settings page at any time. Upgrades take effect immediately; downgrades take effect at the end of your current billing cycle.',
  },
  {
    q: 'What is included in the free Launch plan?',
    a: 'Account agents, Work Inbox, account memory, connected inboxes, approve-first outreach, and safe sending controls. You get 10 starter credits to try lead unlocking.',
  },
  {
    q: 'When should I talk to Bombsell?',
    a: 'Talk to us when you want custom account-agent playbooks, dedicated data sources, security review, team controls, or CRM history ingestion.',
  },
  {
    q: 'Is this a sales engagement tool?',
    a: 'Not exactly. Bombsell includes safe outbound, but the product is broader: account context, GTM memory, next-best-action ranking, and execution guardrails.',
  },
  {
    q: 'How is outbound kept safe?',
    a: 'Automation uses connected inboxes, pacing, daily caps, verified contacts, unsubscribe checks, bounce suppression, reply-stop behavior, and approval modes.',
  },
]

export default function PricingPage() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [isAnnual, setIsAnnual] = useState(false)
  const router = useRouter()
  useSectionReveal()

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      setIsSignedIn(!!data.session)
    })
  }, [])

  async function startFree() {
    if (isSignedIn) {
      router.push('/dashboard')
      return
    }
    setAuthLoading(true)
    const supabase = createClient()
    const callback = new URL('/auth/callback', window.location.origin)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callback.toString(),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) setAuthLoading(false)
  }

  async function startSubscription(tier: 'growth' | 'scale', period: 'monthly' | 'annual') {
    if (!isSignedIn) {
      setAuthLoading(true)
      const supabase = createClient()
      const callback = new URL('/auth/callback', window.location.origin)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callback.toString(),
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      })
      if (error) setAuthLoading(false)
      return
    }

    setAuthLoading(true)
    try {
      const res = await fetch('/api/billing/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, period }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (!res.ok || !data?.url) {
        alert(data?.error ?? 'Unable to start checkout.')
        setAuthLoading(false)
        return
      }
      window.location.assign(data.url)
    } catch {
      alert('Unable to start checkout.')
      setAuthLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden paper">
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <div className="blob blob-1" style={{ width: 600, height: 600, top: -200, left: '50%', transform: 'translateX(-50%)', opacity: 0.45 }} />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight text-[var(--color-text-1)]">Bombsell</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/#platform" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[var(--color-accent)] hover:after:w-full after:transition-all after:duration-300">Platform</Link>
          <Link href="/#differentiators" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[var(--color-accent)] hover:after:w-full after:transition-all after:duration-300">Differentiation</Link>
          <span className="hidden md:block text-[13px] font-medium text-[var(--color-text-1)]">Pricing</span>
          <Link href="/agents" className="hidden md:block text-[13px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[1px] after:bg-[var(--color-accent)] hover:after:w-full after:transition-all after:duration-300">Agents</Link>
          {isSignedIn ? (
            <Link href="/dashboard" className="h-9 px-4 rounded-full btn-primary text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95 transition-transform">
              Dashboard <span aria-hidden>→</span>
            </Link>
          ) : (
            <button
              onClick={startFree}
              disabled={authLoading}
              className="h-9 px-4 rounded-full btn-primary text-[13px] font-medium disabled:opacity-60 flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform"
            >
              {authLoading ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <GoogleIconSmall />}
              {authLoading ? 'Signing in…' : 'Start free'}
            </button>
          )}
        </div>
      </nav>

      <main className="relative z-10 flex-1 flex flex-col items-center px-6 md:px-8 pt-14 md:pt-20 pb-24">
        <div className="section-reveal reveal-from-bottom text-center mb-16 space-y-4 max-w-2xl fade-in">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] font-medium">Pricing</p>
          <h1 className="text-4xl md:text-6xl font-medium text-[var(--color-text-1)] tracking-[-0.02em] leading-[1.02]">
            Start for free.<br />
            <span className="font-serif italic text-gradient">Scale with us.</span>
          </h1>
          <p className="text-[16px] text-[var(--color-text-2)] max-w-lg mx-auto leading-relaxed">
            Use Bombsell for free with starter credits. Scale when your GTM needs more volume and depth.
          </p>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-3 mt-6 p-1 rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-2)]/50">
            <button
              onClick={() => setIsAnnual(false)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all ${!isAnnual ? 'bg-[var(--color-accent)] text-white shadow-sm' : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)]'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all ${isAnnual ? 'bg-[var(--color-accent)] text-white shadow-sm' : 'text-[var(--color-text-3)] hover:text-[var(--color-text-1)]'}`}
            >
              Annual <span className="text-[10px] opacity-80">Save 2 months</span>
            </button>
          </div>
        </div>

        <div className="section-reveal reveal-from-bottom w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 fade-in-stagger">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`relative card p-6 flex flex-col gap-5 transition-all ${
                plan.highlight
                  ? 'ring-1 ring-[var(--color-accent)]/40 shadow-[0_24px_80px_-24px_var(--color-accent-glow)]'
                  : 'hover:shadow-md'
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.15em] px-3 py-1 rounded-full bg-[var(--color-accent)] text-white shadow-md shadow-[var(--color-accent)]/30">
                  Most popular
                </div>
              )}

              <div>
                <p className="text-[13px] text-[var(--color-text-3)] font-medium">{plan.name}</p>
                <div className="flex items-baseline gap-1.5 mt-2.5">
                  <span className="text-4xl font-medium text-[var(--color-text-1)] tracking-[-0.02em]">
                    {plan.id === 'growth' || plan.id === 'scale'
                      ? (isAnnual ? plan.annualPrice : plan.price)
                      : plan.price}
                  </span>
                  <span className="text-[13px] text-[var(--color-text-4)]">
                    {plan.id === 'growth' || plan.id === 'scale'
                      ? (isAnnual ? plan.annualPeriod : plan.period)
                      : plan.period}
                  </span>
                </div>
                <p className="text-[13px] text-[var(--color-text-2)] mt-2 leading-relaxed">{plan.description}</p>
              </div>

              <div className="hairline" />

              <ul className="flex-1 space-y-2.5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-[13px] text-[var(--color-text-1)] leading-snug">
                    <span className="w-4 h-4 rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)] flex items-center justify-center shrink-0 mt-0.5">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              {plan.id === 'free' ? (
                <button
                  onClick={startFree}
                  disabled={authLoading}
                  className="w-full h-11 rounded-full btn-primary text-[13.5px] font-medium disabled:opacity-60"
                >
                  {authLoading ? 'Redirecting…' : plan.cta}
                </button>
              ) : plan.id === 'enterprise' ? (
                <a
                  href={plan.href}
                  className="w-full h-11 rounded-full btn-ghost text-[13.5px] font-medium inline-flex items-center justify-center"
                >
                  {plan.cta}
                </a>
              ) : (
                <button
                  onClick={() => startSubscription(plan.id, isAnnual ? 'annual' : 'monthly')}
                  disabled={authLoading}
                  className={`w-full h-11 rounded-full text-[13.5px] font-medium disabled:opacity-60 ${
                    plan.highlight ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  {authLoading ? 'Starting…' : plan.cta}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* PAYG section */}
        <div className="section-reveal reveal-from-bottom w-full max-w-3xl mt-20">
          <div className="text-center mb-10 space-y-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] font-medium">Pay-as-you-go</p>
            <h2 className="text-2xl md:text-3xl font-medium tracking-[-0.02em] text-[var(--color-text-1)] leading-[1.05]">
              No subscription? No problem.
            </h2>
            <p className="text-[14px] text-[var(--color-text-2)] max-w-md mx-auto">
              Buy lead unlock credits as needed. Credits never expire and roll over month to month.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {PAYG_PACKS.map(pack => (
              <div key={pack.amount} className="card p-4 text-center hover:shadow-md transition-shadow">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-4)]">{pack.label}</p>
                <p className="mt-2 text-2xl font-bold text-[var(--color-text-1)]">${pack.amount}</p>
                <p className="mt-1 text-[13px] text-[var(--color-accent-ring)] font-medium">{pack.credits} unlocks</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-4)]">${(pack.amount / pack.credits).toFixed(2)}/lead</p>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-12 text-[12px] text-[var(--color-text-3)]">
          Launch is free to start · Subscriptions include monthly lead allocations · Credits are prepaid and never expire
        </p>

        <section className="section-reveal reveal-from-bottom w-full max-w-3xl mt-28">
          <div className="text-center mb-12 space-y-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] font-medium">Questions</p>
            <h2 className="text-3xl md:text-4xl font-medium tracking-[-0.02em] text-[var(--color-text-1)] leading-[1.05]">
              What people ask before signing up
            </h2>
          </div>
          <div className="space-y-3">
            {FAQS.map(item => (
              <details
                key={item.q}
                className="group card px-5 py-4 cursor-pointer hover:shadow-md transition-shadow"
              >
                <summary className="flex items-center justify-between list-none text-[14px] font-medium text-[var(--color-text-1)]">
                  {item.q}
                  <span className="w-6 h-6 rounded-full bg-[var(--color-ink-2)] text-[var(--color-text-3)] group-open:bg-[var(--color-accent-bg)] group-open:text-[var(--color-accent-ring)] group-open:rotate-45 transition-all text-lg leading-none flex items-center justify-center">+</span>
                </summary>
                <p className="mt-3 text-[13.5px] text-[var(--color-text-2)] leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="w-full max-w-7xl mx-auto px-6 md:px-8 py-6 text-xs text-[var(--color-text-3)] text-center">
          © {new Date().getFullYear()} Bombsell
        </div>
      </footer>
    </div>
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

function LogoMark() {
  return (
    <Image
      src="/logo.svg"
      alt="Bombsell"
      width={28}
      height={28}
      className="shrink-0"
    />
  )
}
