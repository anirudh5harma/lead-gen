'use client'

import Link from 'next/link'
import { useState } from 'react'
import Icon from '@/components/Icon'
import ScrollReveal from '@/components/ui/ScrollReveal'
import { MarketingFooter, MarketingNav, FOUNDER_CALL_URL } from '@/components/marketing/MarketingChrome'

type Plan = {
  id: string
  name: string
  tagline: string
  monthly: number | null
  annual: number | null
  cta: string
  href: string
  external?: boolean
  featured?: boolean
  features: string[]
}

const PLANS: Plan[] = [
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Operators running real pipeline',
    monthly: 49,
    annual: 490,
    cta: 'Start free',
    href: '/auth/start',
    featured: true,
    features: [
      'Signal ingestion across 15+ sources',
      'Buyer profile built from your URL',
      'Verified contacts — email + LinkedIn',
      'Unlimited outreach across email + LinkedIn',
      'Adaptive multi-step sequencing',
      'Agent drafts with hot-path judge',
      'Reply classification + attribution',
      'Bring your own LLM keys',
    ],
  },
  {
    id: 'agency',
    name: 'Agency',
    tagline: 'Operators running many workspaces',
    monthly: null,
    annual: null,
    cta: 'Talk to founder',
    href: FOUNDER_CALL_URL,
    external: true,
    features: [
      'Everything in Pro',
      'Unlimited client workspaces',
      'Owned-domain sending + warmup',
      'Priority deliverability monitoring',
      'Custom sending volume',
      'Onboarding with the founder',
    ],
  },
]

export default function PricingPage() {
  const [annual, setAnnual] = useState(false)

  return (
    <main className="relative isolate flex min-h-[100dvh] flex-col bg-[var(--color-ink-1)] text-[var(--color-text-1)]">
      <MarketingNav />

      <div className="flex-1">
        {/* Header */}
        <section className="mx-auto max-w-[1280px] px-4 pb-10 pt-28 text-center md:px-8 md:pt-36">
          <ScrollReveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
              Pricing
            </p>
            <h1
              className="mx-auto mt-4 max-w-[18ch] text-[clamp(2.25rem,5.2vw,4rem)] font-bold leading-[1.0] tracking-[-0.04em]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              One agent. One bill. No seat tax.
            </h1>
            <p className="mx-auto mt-5 max-w-[460px] text-[16.5px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-2)]">
              Start free, no credit card. You only pay when the agent produces outcomes worth paying for.
            </p>
          </ScrollReveal>

          {/* Billing toggle */}
          <ScrollReveal delay={0.1}>
            <div className="mt-9 inline-flex items-center gap-1 rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-1">
              <button
                type="button"
                onClick={() => setAnnual(false)}
                aria-pressed={!annual}
                className={
                  'inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold tracking-[-0.01em] transition-colors ' +
                  (!annual
                    ? 'bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]'
                    : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]')
                }
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setAnnual(true)}
                aria-pressed={annual}
                className={
                  'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold tracking-[-0.01em] transition-colors ' +
                  (annual
                    ? 'bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]'
                    : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]')
                }
              >
                Annual
                <span className="rounded-full bg-[var(--color-brand-green)] px-1.5 py-0.5 text-[10px] font-bold text-[#273416]">
                  2 months free
                </span>
              </button>
            </div>
          </ScrollReveal>
        </section>

        {/* Plans */}
        <section className="mx-auto max-w-[1280px] px-4 pb-16 md:px-8">
          <div className="mx-auto grid max-w-[820px] grid-cols-1 gap-4 md:grid-cols-2">
            {PLANS.map((plan, i) => {
              const price = annual ? plan.annual : plan.monthly
              return (
                <ScrollReveal key={plan.id} delay={i * 0.08}>
                  <div
                    className={
                      'relative flex h-full flex-col rounded-[20px] p-7 ' +
                      (plan.featured
                        ? 'bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]'
                        : 'border border-[var(--color-line-1)] bg-[var(--color-ink-0)]')
                    }
                  >
                    {plan.featured ? (
                      <span className="btn-brand-on-dark tone-green absolute right-6 top-6">
                        Most popular
                      </span>
                    ) : null}
                    <h2
                      className="text-[22px] font-bold tracking-[-0.02em]"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {plan.name}
                    </h2>
                    <p
                      className={
                        'mt-1.5 text-[13.5px] leading-[1.5] tracking-[-0.01em] ' +
                        (plan.featured ? 'text-[#fff9]' : 'text-[var(--color-text-3)]')
                      }
                    >
                      {plan.tagline}
                    </p>

                    <div className="mt-6 flex items-end gap-1.5">
                      {price === null ? (
                        <span className="text-[34px] font-bold tracking-[-0.03em]" style={{ fontFamily: 'var(--font-display)' }}>
                          Custom
                        </span>
                      ) : (
                        <>
                          <span className="text-[44px] font-bold leading-none tracking-[-0.04em]" style={{ fontFamily: 'var(--font-display)' }}>
                            ${annual ? Math.round(price / 12) : price}
                          </span>
                          <span className={'mb-1.5 text-[13px] ' + (plan.featured ? 'text-[#fff9]' : 'text-[var(--color-text-3)]')}>
                            / month
                          </span>
                        </>
                      )}
                    </div>
                    {price !== null && annual ? (
                      <p className={'mt-1 text-[12px] ' + (plan.featured ? 'text-[#fff9]' : 'text-[var(--color-text-3)]')}>
                        ${price} billed yearly
                      </p>
                    ) : (
                      <p className="mt-1 h-[18px]" />
                    )}

                    {plan.external ? (
                      <a
                        href={plan.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={
                          'mt-6 inline-flex h-12 items-center justify-center gap-1.5 rounded-full px-6 text-[14px] font-semibold tracking-[-0.01em] transition-transform active:scale-[0.98] ' +
                          (plan.featured
                            ? 'bg-[var(--color-ink-0)] text-[var(--color-text-1)] hover:bg-[#f7f7f7]'
                            : 'border border-[var(--color-line-2)] bg-[var(--color-ink-0)] text-[var(--color-text-1)] hover:border-[var(--color-line-3)]')
                        }
                      >
                        {plan.cta}
                        <Icon name="arrow_forward" size={15} />
                      </a>
                    ) : (
                      <Link
                        href={plan.href}
                        className={
                          'mt-6 inline-flex h-12 items-center justify-center gap-1.5 rounded-full px-6 text-[14px] font-semibold tracking-[-0.01em] transition-transform active:scale-[0.98] ' +
                          (plan.featured
                            ? 'bg-[var(--color-ink-0)] text-[var(--color-text-1)] hover:bg-[#f7f7f7]'
                            : 'bg-[var(--color-cta-bg)] text-[var(--color-cta-text)] hover:bg-[var(--color-cta-hover)]')
                        }
                      >
                        {plan.cta}
                        <Icon name="arrow_forward" size={15} />
                      </Link>
                    )}

                    <ul className="mt-7 grid gap-3">
                      {plan.features.map((f) => (
                        <li key={f} className="grid grid-cols-[18px_1fr] gap-2.5 text-[13.5px] leading-[1.5] tracking-[-0.01em]">
                          <Icon
                            name="check"
                            size={15}
                            className={plan.featured ? 'text-[var(--color-brand-green-bright)]' : 'text-[var(--color-pos)]'}
                          />
                          <span className={plan.featured ? 'text-[#fff]/90' : 'text-[var(--color-text-2)]'}>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </ScrollReveal>
              )
            })}
          </div>

          <p className="mt-8 text-center text-[12.5px] text-[var(--color-text-3)]">
            Both plans include the hot-path judge, reply attribution, and full message provenance. Start free — no credit card, cancel anytime.
          </p>
        </section>
      </div>

      <MarketingFooter />
    </main>
  )
}
