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
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Try the core signal feed.',
    features: [
      '15 lead unlocks for free',
      'AI prompt discovery',
      'Personalized outreach drafts',
      'Verified contact emails',
      'CRM sync and exports',
      'Manual Send/Export',
    ],
    cta: 'Get started',
    highlight: false,
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$99',
    period: '/ month',
    description: 'For solopreneurs, B2B founders and SDRs',
    features: [
      'Up to 500 leads / month',
      'Multiple client workspaces',
      'Auto-send Gmail/Outlook',
      'Reply detection and follow-ups',
      'Slack signal alerts',
      'Priority enrichment queue',
      'Everything in Free',
    ],
    cta: 'Upgrade to Pro',
    highlight: true,
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise OS',
    price: 'Custom',
    period: '',
    description: 'For teams looking to scale with revenue intelligence',
    features: [
      'Managed revenue workflows',
      'Enterprise CRM governance',
      'Custom agent playbooks',
      'Dedicated signal sources',
      'Operator-in-the-loop execution',
      'Security and audit controls',
    ],
    cta: 'Talk to us',
    highlight: false,
    href: 'mailto:team@bombsell.com?subject=Enterprise%20Revenue%20OS',
  },
]

const FAQS = [
  {
    q: 'Do follow-ups count against my lead quota?',
    a: 'No. Your monthly lead quota only controls how many new leads enter your feed in a rolling 30-day window. Follow-ups are included on Pro and do not consume additional lead quota.',
  },
  {
    q: 'What happens when I hit my limit?',
    a: 'Free users can keep browsing all matched signals, but only 15 leads per rolling 30-day window can be fully unlocked with contacts and drafts. Pro includes 500 leads monthly and can top up prepaid lead credits when more unlocks are needed.',
  },
  {
    q: 'Which plan includes client workspaces?',
    a: 'Pro. CRM sync and exports are available on every plan, but Pro unlocks multiple client workspaces with separate targeting, templates, and feed views.',
  },
  {
    q: 'Can I cancel or change plans anytime?',
    a: 'Yes. Upgrades take effect immediately; downgrades apply at the end of the billing period. No contracts.',
  },
  {
    q: 'Where do signals come from?',
    a: 'Google News, press wires, and public job boards — refreshed every hour. Every signal is scored against your ICP and product positioning by Bombsell before it reaches your feed.',
  },
  {
    q: 'How do you verify contact emails?',
    a: "We run a multi-stage waterfall — then cross-check every address with ZeroBounce before it ever reaches you. Emails that bounce or generate complaints are permanently suppressed.",
  },
]

export default function PricingPage() {
  const [loading, setLoading] = useState<'pro' | null>(null)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const router = useRouter()
  useSectionReveal()

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      setIsSignedIn(!!data.session)
    })
  }, [])

  async function startCheckout(plan: 'pro') {
    setLoading(plan)
    setCheckoutError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.assign(data.url)
      } else {
        setCheckoutError(data.error || 'Unable to start checkout right now.')
        setLoading(null)
      }
    } catch {
      setCheckoutError('Unable to start checkout right now.')
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden paper">
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <div className="blob blob-1" style={{ width: 600, height: 600, top: -200, left: '50%', transform: 'translateX(-50%)', opacity: 0.7 }} />
      </div>

      <nav className="relative z-10 border-b border-[var(--color-line-1)] bg-[var(--color-ink-1)]/70 backdrop-blur-md">
        <div className="w-full max-w-7xl mx-auto flex items-center justify-between px-6 md:px-8 h-16">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[15px] font-medium text-[var(--color-text-1)] tracking-tight">Bombsell</span>
          </Link>
          {isSignedIn && (
            <Link href="/dashboard" className="text-[13px] text-[var(--color-text-2)] hover:text-[var(--color-text-1)] transition-colors">
              Back to dashboard →
            </Link>
          )}
        </div>
      </nav>

      <main className="relative z-10 flex-1 flex flex-col items-center px-6 md:px-8 pt-20 md:pt-28 pb-24">
        <div className="section-reveal reveal-from-bottom text-center mb-16 space-y-4 max-w-2xl fade-in">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] font-medium">Pricing</p>
          <h1 className="text-4xl md:text-6xl font-medium text-[var(--color-text-1)] tracking-[-0.02em] leading-[1.02]">
            Simple pricing.<br />
            <span className="font-serif italic text-gradient">Outsized outcomes.</span>
          </h1>
          <p className="text-[16px] text-[var(--color-text-2)] max-w-lg mx-auto leading-relaxed">
            Start free. Upgrade when signals start converting into pipeline.
          </p>
        </div>

        <div className="section-reveal reveal-from-bottom w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-5 fade-in-stagger">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`relative card p-7 flex flex-col gap-6 transition-all ${
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
                  <span className="text-5xl font-medium text-[var(--color-text-1)] tracking-[-0.02em]">{plan.price}</span>
                  <span className="text-[13px] text-[var(--color-text-4)]">{plan.period}</span>
                </div>
                <p className="text-[13px] text-[var(--color-text-2)] mt-2 leading-relaxed">{plan.description}</p>
              </div>

              <div className="hairline" />

              <ul className="flex-1 space-y-3">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-[var(--color-text-1)] leading-snug">
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
                  onClick={() => router.push('/dashboard')}
                  className="w-full h-11 rounded-full btn-ghost text-[13.5px] font-medium"
                >
                  {plan.cta}
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
                  onClick={() => startCheckout(plan.id)}
                  disabled={loading === plan.id}
                  className={`w-full h-11 rounded-full text-[13.5px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                    plan.highlight ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  {loading === plan.id ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Redirecting…
                    </span>
                  ) : plan.cta}
                </button>
              )}
            </div>
          ))}
        </div>

        <p className="mt-12 text-[12px] text-[var(--color-text-3)]">
          All plans include Google OAuth · SSL · 99.9% uptime · Cancel anytime
        </p>
        {checkoutError && (
          <p className="mt-4 rounded-lg border border-[var(--color-sig-regulation)]/20 bg-[var(--color-sig-regulation-bg)] px-4 py-3 text-[13px] text-[var(--color-sig-regulation)]">
            {checkoutError}
          </p>
        )}

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

function LogoMark() {
  return (
    <Image
      src="/logo.svg"
      alt="Bombsell"
      width={32}
      height={32}
      className="shrink-0"
    />
  )
}
