'use client'

import Image from 'next/image'
import Link from 'next/link'
import BrandIcon from '@/components/BrandIcon'
import Icon from '@/components/Icon'
import ScrollReveal from '@/components/ui/ScrollReveal'
import { googleAuthPath, PRODUCT_HOME_PATH } from '@/lib/auth/next'

const TRUST_LOGOS = [
  { name: 'Vercel', slug: 'vercel' },
  { name: 'Stripe', slug: 'stripe' },
  { name: 'Notion', slug: 'notion' },
  { name: 'Linear', slug: 'linear' },
  { name: 'Figma', slug: 'figma' },
  { name: 'Raycast', slug: 'raycast' },
]

const FEATURES = [
  {
    title: 'Your buyer profile builds itself',
    description: 'Bombsell reads your website and instantly understands what you sell, who you target, and how to pitch you. No manual list building.',
    icon: 'person',
    accent: 'teal',
  },
  {
    title: 'Quality signals',
    description: 'Track job posts, funding, product launches, and inbound activity so outreach starts from real timing evidence.',
    icon: 'sensors',
    accent: 'pink',
  },
  {
    title: 'Verified contacts',
    description: 'Qualified signals turn into reachable contacts with verified emails and LinkedIn profiles.',
    icon: 'account_tree',
    accent: 'green',
  },
  {
    title: 'Agent outreach with proof',
    description: 'The agent sends email and LinkedIn outreach, tracks replies and meetings, and keeps every draft inspectable.',
    icon: 'fact_check',
    accent: 'blue',
  },
]

const STACK = [
  { icon: 'edit', title: 'Copywriting', desc: 'AI-personalized messages at scale' },
  { icon: 'account_tree', title: 'Sequencing', desc: 'Smart multi-step sequences' },
  { icon: 'sensors', title: 'Signal tracking', desc: '15+ buying signals monitored' },
  { icon: 'travel_explore', title: 'Lead finding', desc: 'Total addressable market graph' },
]

const STEPS = [
  { number: '01', title: 'Enter your website', description: 'Bombsell reads your site and understands your product, ICP, and pitch.' },
  { number: '02', title: 'Your agent finds buyers', description: 'It detects buying signals, verifies contacts, and starts outreach.' },
  { number: '03', title: 'Demos land in your calendar', description: 'You wake up to qualified leads already interested.' },
]

const FOOTER_LINKS = {
  Product: [
    { label: 'Features', href: '/' },
    { label: 'Pricing', href: '#' },
    { label: 'Changelog', href: '#' },
  ],
  Resources: [
    { label: 'Documentation', href: '#' },
    { label: 'API Reference', href: '#' },
    { label: 'Blog', href: '#' },
  ],
  Company: [
    { label: 'About', href: '#' },
    { label: 'Careers', href: '#' },
    { label: 'Contact', href: '#' },
  ],
  Legal: [
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
  ],
}

const accentBg: Record<string, string> = {
  teal: 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]',
  pink: 'bg-[var(--color-brand-pink)]/20 text-[#9a0103]',
  green: 'bg-[var(--color-brand-green)]/30 text-[#273416]',
  blue: 'bg-[var(--color-brand-blue)]/30 text-[#0a0d27]',
}

const SIGNAL_DOTS = [
  'bg-[var(--color-brand-pink)]',
  'bg-[var(--color-accent)]',
  'bg-[var(--color-brand-green)]',
  'bg-[var(--color-brand-blue)]',
]

export default function Home() {
  return (
    <main className="monaco-canvas relative isolate min-h-[100dvh] overflow-hidden text-[var(--color-text-1)]">
      <div className="animated-bg">
        <div className="animated-bg-orb animated-bg-orb-1" />
        <div className="animated-bg-orb animated-bg-orb-2" />
        <div className="animated-bg-orb animated-bg-orb-3" />
        <div className="animated-bg-orb animated-bg-orb-4" />
      </div>

      <header className="glass-nav fixed left-0 right-0 top-0 z-50">
        <div className="mx-auto flex h-[60px] w-full max-w-[1200px] items-center justify-between px-6 md:px-10 lg:px-16">
          <Link href="/" className="flex items-center gap-2.5 text-[1.125rem] font-semibold text-[var(--color-text-1)] tracking-[-0.02em]" style={{ fontFamily: 'var(--font-display)' }}>
            <Image src="/logo.svg" alt="" width={28} height={28} priority unoptimized className="size-7" />
            Bombsell
          </Link>
          <Link
            href={googleAuthPath(PRODUCT_HOME_PATH)}
            className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-text-2)] transition-colors hover:border-[var(--color-line-3)] hover:text-[var(--color-text-1)]"
          >
            <BrandIcon name="google" size={16} />
            Log in
          </Link>
        </div>
      </header>

      <section className="relative z-10 flex min-h-[100dvh] items-center px-6 pt-20 pb-16 md:px-10 md:pt-24 md:pb-20 lg:px-16">
        <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="order-2 lg:order-1">
            <ScrollReveal delay={0.1}>
              <p className="mono text-[var(--color-text-3)]">Signal-led outbound</p>
            </ScrollReveal>
            <ScrollReveal delay={0.2}>
              <h1 className="mt-5 text-[clamp(2.25rem,5vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-[var(--color-text-1)]" style={{ fontFamily: 'var(--font-display)' }}>
                Autonomous outbound for lean teams
              </h1>
            </ScrollReveal>
            <ScrollReveal delay={0.3}>
              <p className="mt-5 max-w-[460px] text-[17px] leading-[1.55] text-[var(--color-text-2)]">
                Quality signals, verified contacts, and email or LinkedIn outreach in one focused agent.
              </p>
            </ScrollReveal>
            <ScrollReveal delay={0.4}>
              <form action="/auth/start" method="GET" className="mt-8 flex w-full max-w-[440px] flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-4)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    name="url"
                    placeholder="yourcompany.com"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9\-_.]*\.[a-zA-Z]{2,}"
                    title="Enter a valid domain like yourcompany.com"
                    className="w-full rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] py-3 pl-10 pr-4 text-[15px] text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] outline-none transition-colors focus:border-[var(--color-text-1)] focus:ring-2 focus:ring-[var(--color-text-1)]/10"
                  />
                </div>
                <button type="submit" className="btn-solid whitespace-nowrap">
                  Get started
                </button>
              </form>
            </ScrollReveal>
            <ScrollReveal delay={0.5}>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {['Live in 5 minutes', 'No credit card', 'Cancel anytime'].map((badge) => (
                  <span key={badge} className="pill text-[11px]">
                    <span className="pulse-dot mr-1.5 inline-block" />
                    {badge}
                  </span>
                ))}
              </div>
            </ScrollReveal>
          </div>

          <div className="order-1 lg:order-2">
            <ScrollReveal delay={0.3}>
              <HeroVisual />
            </ScrollReveal>
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-10 md:px-10 md:py-12 lg:px-16">
          <p className="mb-6 text-center text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-3)]">
            Trusted by fast-moving teams
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-10">
            {TRUST_LOGOS.map((logo) => (
              <img
                key={logo.slug}
                src={`https://cdn.simpleicons.org/${logo.slug}/212121`}
                alt={logo.name}
                width={24}
                height={24}
                className="h-6 w-auto opacity-60 transition-opacity hover:opacity-100"
              />
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-16 md:px-10 md:py-20 lg:px-16 lg:py-24">
          <ScrollReveal>
            <div className="mb-12 max-w-[520px]">
              <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-[var(--color-text-1)]" style={{ fontFamily: 'var(--font-display)' }}>
                Everything you need to fill your pipeline
              </h2>
              <p className="mt-4 text-[16px] leading-[1.6] text-[var(--color-text-2)]">
                One agent that profiles your company, finds signals, verifies contacts, and sends outreach.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="md:col-span-2 lg:col-span-2">
              <ScrollReveal>
                <div className="group relative overflow-hidden rounded-[14px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-6 md:p-8 transition-colors hover:border-[var(--color-line-2)]">
                  <div className={`mb-4 grid size-10 place-items-center rounded-[10px] ${accentBg[FEATURES[0].accent]}`}>
                    <Icon name={FEATURES[0].icon} size={18} />
                  </div>
                  <h3 className="text-[18px] font-semibold text-[var(--color-text-1)]">{FEATURES[0].title}</h3>
                  <p className="mt-2 max-w-[420px] text-[14px] leading-[1.6] text-[var(--color-text-2)]">{FEATURES[0].description}</p>
                </div>
              </ScrollReveal>
            </div>

            <div>
              <ScrollReveal delay={0.1}>
                <div className="group relative overflow-hidden rounded-[14px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-6 transition-colors hover:border-[var(--color-line-2)]">
                  <div className={`mb-4 grid size-10 place-items-center rounded-[10px] ${accentBg[FEATURES[1].accent]}`}>
                    <Icon name={FEATURES[1].icon} size={18} />
                  </div>
                  <h3 className="text-[18px] font-semibold text-[var(--color-text-1)]">{FEATURES[1].title}</h3>
                  <p className="mt-2 text-[14px] leading-[1.6] text-[var(--color-text-2)]">{FEATURES[1].description}</p>
                </div>
              </ScrollReveal>
            </div>

            <div>
              <ScrollReveal delay={0.15}>
                <div className="group relative overflow-hidden rounded-[14px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-6 transition-colors hover:border-[var(--color-line-2)]">
                  <div className={`mb-4 grid size-10 place-items-center rounded-[10px] ${accentBg[FEATURES[2].accent]}`}>
                    <Icon name={FEATURES[2].icon} size={18} />
                  </div>
                  <h3 className="text-[18px] font-semibold text-[var(--color-text-1)]">{FEATURES[2].title}</h3>
                  <p className="mt-2 text-[14px] leading-[1.6] text-[var(--color-text-2)]">{FEATURES[2].description}</p>
                </div>
              </ScrollReveal>
            </div>

            <div className="md:col-span-1 lg:col-span-2">
              <ScrollReveal delay={0.2}>
                <div className="group relative overflow-hidden rounded-[14px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-6 md:p-8 transition-colors hover:border-[var(--color-line-2)]">
                  <div className={`mb-4 grid size-10 place-items-center rounded-[10px] ${accentBg[FEATURES[3].accent]}`}>
                    <Icon name={FEATURES[3].icon} size={18} />
                  </div>
                  <h3 className="text-[18px] font-semibold text-[var(--color-text-1)]">{FEATURES[3].title}</h3>
                  <p className="mt-2 max-w-[420px] text-[14px] leading-[1.6] text-[var(--color-text-2)]">{FEATURES[3].description}</p>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 pt-16 pb-24 md:px-10 md:pt-20 md:pb-32 lg:px-16 lg:pt-24 lg:pb-40">
          <ScrollReveal>
            <div className="mx-auto max-w-[640px] text-center mb-10">
              <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-[var(--color-text-1)]" style={{ fontFamily: 'var(--font-display)' }}>
                Replaces your entire outreach toolkit
              </h2>
            </div>
          </ScrollReveal>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {STACK.map((card, i) => (
              <ScrollReveal key={i} delay={i * 0.1}>
                <div className="layer-stack">
                  <div className="layer-back" />
                  <div className="layer-front relative z-10 rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 depth-lift">
                    <div className="grid size-10 place-items-center rounded-[10px] bg-[var(--color-accent-bg)] text-[var(--color-accent)] mb-3">
                      <Icon name={card.icon} size={18} />
                    </div>
                    <p className="text-[15px] font-semibold text-[var(--color-text-1)]">{card.title}</p>
                    <p className="mt-1 text-[13px] text-[var(--color-text-3)]">{card.desc}</p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 pt-20 pb-16 md:px-10 md:pt-28 md:pb-20 lg:px-16 lg:pt-36 lg:pb-24">
          <ScrollReveal>
            <div className="mx-auto max-w-[640px] text-center mb-10">
              <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-[var(--color-text-1)]" style={{ fontFamily: 'var(--font-display)' }}>
                3 minutes to set up. First results today.
              </h2>
            </div>
          </ScrollReveal>
          <div className="relative grid gap-6 md:grid-cols-3">
            <div className="hidden md:block absolute top-10 left-[16.67%] right-[16.67%] h-[1px] bg-[var(--color-line-2)]" />
            {STEPS.map((step, i) => (
              <ScrollReveal key={step.number} delay={i * 0.15}>
                <div className="relative text-center">
                  <div className="mx-auto grid size-12 place-items-center rounded-full border-2 border-[var(--color-text-1)] bg-[var(--color-ink-0)] text-[var(--color-text-1)] font-mono text-[13px] font-semibold relative z-10">
                    {step.number}
                  </div>
                  <h3 className="mt-5 text-[1.0625rem] font-semibold text-[var(--color-text-1)]">{step.title}</h3>
                  <p className="mt-2 text-[15px] leading-[1.65] text-[var(--color-text-2)] max-w-[320px] mx-auto">{step.description}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-16 md:px-10 md:py-20 lg:px-16 lg:py-24">
          <ScrollReveal>
            <div className="mx-auto max-w-[560px] text-center">
              <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-[var(--color-text-1)]" style={{ fontFamily: 'var(--font-display)' }}>
                Start growing your pipeline today
              </h2>
              <p className="mt-4 text-[16px] leading-[1.65] text-[var(--color-text-2)]">
                Free to start. No credit card required. Your first buyer profile builds in minutes.
              </p>
              <div className="mt-8">
                <Link href={googleAuthPath('/onboarding')} className="btn-solid">
                  Get started free
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[var(--color-line-1)] bg-[var(--color-ink-0)]">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-14 md:px-10 md:py-16 lg:px-16">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-6">
            <div className="col-span-2">
              <div className="flex items-center gap-2.5 text-[1.0625rem] font-semibold text-[var(--color-text-1)]" style={{ fontFamily: 'var(--font-display)' }}>
                <Image src="/logo.svg" alt="" width={24} height={24} unoptimized className="size-6" />
                Bombsell
              </div>
              <p className="mt-4 max-w-[260px] text-[13px] leading-[1.6] text-[var(--color-text-3)]">
                Signal-led outbound for modern GTM teams. Build the profile, watch for quality signals, and let the agent send.
              </p>
            </div>
            {Object.entries(FOOTER_LINKS).map(([category, links]) => (
              <div key={category}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-1)]">{category}</p>
                <ul className="mt-4 grid gap-2.5">
                  {links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-[13px] text-[var(--color-text-3)] transition-colors hover:text-[var(--color-text-1)]">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[var(--color-line-1)] pt-6 md:flex-row">
            <p className="text-[12px] text-[var(--color-text-4)]">
              &copy; {new Date().getFullYear()} Bombsell. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-4)] transition-colors hover:text-[var(--color-text-2)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-4)] transition-colors hover:text-[var(--color-text-2)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[480px] aspect-square">
      <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-[var(--color-accent-bg)] to-[var(--color-brand-blue)]/30 opacity-60" />
      <div className="absolute inset-4 rounded-[16px] bg-[var(--color-ink-0)] border border-[var(--color-line-1)] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.08)] p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2 pb-3 border-b border-[var(--color-line-1)]">
          <span className="size-2.5 rounded-full bg-[var(--color-neg)]" />
          <span className="size-2.5 rounded-full bg-[var(--color-warn)]" />
          <span className="size-2.5 rounded-full bg-[var(--color-pos)]" />
          <span className="ml-2 text-[11px] text-[var(--color-text-4)]">app.bombsell.com</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill pill-accent text-[10px]">Live</span>
          <span className="text-[11px] text-[var(--color-text-3)]">12 signals detected today</span>
        </div>
        <div className="grid gap-2">
          {['Hiring SDRs', 'Raised Series B', 'New CTO', 'Website redesign'].map((signal, i) => (
            <div key={signal} className="flex items-center justify-between rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`size-1.5 rounded-full ${SIGNAL_DOTS[i]}`} />
                <span className="text-[12px] font-medium text-[var(--color-text-1)]">{signal}</span>
              </div>
              <span className="text-[10px] text-[var(--color-text-4)]">{['2h', '4h', '6h', '1d'][i]} ago</span>
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2">
          <span className="text-[11px] text-[var(--color-text-3)]">Emails sent today</span>
          <span className="text-[14px] font-semibold text-[var(--color-text-1)]">38</span>
        </div>
      </div>
    </div>
  )
}
