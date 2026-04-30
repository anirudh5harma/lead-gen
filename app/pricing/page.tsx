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
    name: 'Self-serve',
    price: '$0',
    period: 'forever',
    description: 'A complete workspace for experiencing our true AI-native GTM infrastructure.',
    features: [
      '20 starter lead credits',
      'Live Autopilot and Work Inbox',
      'Gmail and Outlook connectors',
      'CRM export and Slack alerts',
      'MCP access',
      'Top up credits as needed',
    ],
    cta: 'Get started',
    highlight: true,
  },
  {
    id: 'enterprise' as const,
    name: 'Managed Infrastructure',
    price: 'Custom',
    period: '',
    description: 'For teams that want Bombsell to run governed GTM workflows with stronger controls.',
    features: [
      'Managed GTM workflow design',
      'Custom account agents and playbooks',
      'Enterprise CRM governance',
      'Dedicated source connectors',
      'Operator-in-the-loop execution',
      'Security reviews and audit controls',
    ],
    cta: 'Talk to us',
    highlight: false,
    href: 'mailto:team@bombsell.com?subject=Managed%20GTM%20Infrastructure',
  },
]

const FAQS = [
  {
    q: 'What do credits pay for?',
    a: 'Credits are used when Bombsell unlocks a lead/contact. Monitoring accounts, reviewing work items, using MCP, connecting inboxes, and managing settings do not consume credits.',
  },
  {
    q: 'What happens when I run out of credits?',
    a: 'Your workspace still works, but new contact unlocks pause until you top up. Existing memories, workflows, CRM exports, and account context remain available.',
  },
  {
    q: 'What is included in self-serve?',
    a: 'Live Autopilot, Work Inbox, watched accounts, connected inboxes, CRM export queue, Slack alerts, GTM memory, and Agent API/MCP access.',
  },
  {
    q: 'When should I talk to Bombsell?',
    a: 'Talk to us when you want custom account agents, governed CRM workflows, dedicated data sources, security review, or an operator-in-the-loop motion.',
  },
  {
    q: 'Is this a sales engagement tool?',
    a: 'Not exactly. Bombsell includes safe outbound, but the product is broader: account context, GTM memory, agent work, workflow controls, and execution guardrails.',
  },
  {
    q: 'How is outbound kept safe?',
    a: 'Automation uses connected inboxes, pacing, daily caps, verified contacts, unsubscribe checks, bounce suppression, reply-stop behavior, and approval modes.',
  },
]

export default function PricingPage() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
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
            Start self-serve.<br />
            <span className="font-serif italic text-gradient">Scale with us.</span>
          </h1>
          <p className="text-[16px] text-[var(--color-text-2)] max-w-lg mx-auto leading-relaxed">
            Use Bombsell for free with starter credits. Move to managed GTM infrastructure when your motion needs more control.
          </p>
        </div>

        <div className="section-reveal reveal-from-bottom w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-5 fade-in-stagger">
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
                  onClick={startFree}
                  disabled={authLoading}
                  className="w-full h-11 rounded-full btn-primary text-[13.5px] font-medium disabled:opacity-60"
                >
                  {authLoading ? 'Redirecting…' : plan.cta}
                </button>
              ) : (
                <a
                  href={plan.href}
                  className="w-full h-11 rounded-full btn-ghost text-[13.5px] font-medium inline-flex items-center justify-center"
                >
                  {plan.cta}
                </a>
              )}
            </div>
          ))}
        </div>

        <p className="mt-12 text-[12px] text-[var(--color-text-3)]">
          Self-serve is free to start · Credits are prepaid · Managed infrastructure is custom
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
