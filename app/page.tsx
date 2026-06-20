'use client'

import Link from 'next/link'
import Icon from '@/components/Icon'
import ScrollReveal from '@/components/ui/ScrollReveal'
import { MarketingNav, MarketingFooter, FOUNDER_CALL_URL } from '@/components/marketing/MarketingChrome'
import { googleAuthPath } from '@/lib/auth/next'

// Real integrations Bombsell actually connects to — honest "works with",
// not borrowed-credibility "trusted by". Outlook/LinkedIn/Slack ship as inline
// SVG because Simple Icons removed those brand marks (trademark) and the CDN
// 404s them; the rest load reliably from the Simple Icons CDN.
type Integration = { name: string; slug?: string; path?: string }
const INTEGRATIONS: Integration[] = [
  {
    name: 'Microsoft Outlook',
    path: 'M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.76.1.43.1.85zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V10.85l1.24.72h.01q.1.07.18.18.07.12.07.25zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.03l2.41 1.5 1.34-.8v-2.73zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.19-.86.48-.55.73-1.28.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.3-1.2.85-.5.54-.75 1.3-.25.74-.25 1.63 0 .85.26 1.56.26.72.74 1.24.48.52 1.17.81.69.28 1.56.28zM7.5 21h12.39L12 16.08V17q0 .41-.3.7-.29.3-.7.3H7.5z',
  },
  {
    name: 'LinkedIn',
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  },
  {
    name: 'Slack',
    path: 'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.685 8.834a2.528 2.528 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.527 2.527 0 0 1 15.164 0a2.528 2.528 0 0 1 2.521 2.522v6.312zM15.164 18.956a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.164 24a2.527 2.527 0 0 1-2.521-2.522v-2.522h2.521zM15.164 17.685a2.527 2.527 0 0 1-2.521-2.52 2.526 2.526 0 0 1 2.521-2.521h6.314A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.52h-6.314z',
  },
  { name: 'HubSpot', slug: 'hubspot' },
]

const FEATURES = [
  {
    tag: 'Profile',
    step: '01',
    title: 'Your buyer profile builds itself',
    description: 'Drop a URL. Bombsell reads your site, distills positioning, audience, and pitch — no manual list building.',
    tone: 'pink',
  },
  {
    tag: 'Signals',
    step: '02',
    title: 'Quality signals, ranked by intent',
    description: 'Job posts, funding, product launches, inbound activity. Outreach starts from real timing evidence.',
    tone: 'yellow',
  },
  {
    tag: 'Contacts',
    step: '03',
    title: 'Verified contacts',
    description: 'Qualified signals become reachable people — verified email plus LinkedIn profile, never one without the other.',
    tone: 'green',
  },
  {
    tag: 'Outreach',
    step: '04',
    title: 'Agent outreach with proof',
    description: 'The agent drafts, judges, and sends across email and LinkedIn. Every message inspectable. Every reply attributed.',
    tone: 'blue',
  },
]

const STACK = [
  { icon: 'edit', title: 'Copywriting', desc: 'Personalized at scale', tone: 'pink' },
  { icon: 'account_tree', title: 'Sequencing', desc: 'Adaptive multi-step plays', tone: 'blue' },
  { icon: 'sensors', title: 'Signals', desc: '15+ buying signals tracked', tone: 'yellow' },
  { icon: 'travel_explore', title: 'Finder', desc: 'TAM graph + lookalikes', tone: 'green' },
  { icon: 'verified', title: 'Verification', desc: 'Email + LinkedIn proof', tone: 'blue' },
  { icon: 'auto_graph', title: 'Learning', desc: 'Win patterns by week', tone: 'pink' },
]

const STEPS = [
  {
    number: '01',
    title: 'Enter your URL',
    description: 'Bombsell ingests your site. Builds positioning, ICP, voice, and a starter signal map in minutes.',
  },
  {
    number: '02',
    title: 'Your agent works',
    description: 'It detects buying signals, verifies contacts across email and LinkedIn, judges drafts before they send.',
  },
  {
    number: '03',
    title: 'Meetings land',
    description: 'You review proof, approve, and watch qualified replies show up in calendar. No spray, no chase.',
  },
]

const PROOF_SIGNALS = [
  { kind: 'Hiring SDRs', who: 'Linear', when: '2h', tone: 'pink' },
  { kind: 'Raised Series B', who: 'Glia', when: '4h', tone: 'green' },
  { kind: 'New CTO', who: 'Cresta', when: '6h', tone: 'yellow' },
  { kind: 'Website redesign', who: 'Sift', when: '1d', tone: 'blue' },
]

const TONE_BG: Record<string, string> = {
  pink: 'bg-[var(--color-brand-pink)] text-[#9a0103]',
  yellow: 'bg-[var(--color-brand-yellow)] text-[#441f16]',
  green: 'bg-[var(--color-brand-green)] text-[#273416]',
  blue: 'bg-[var(--color-brand-blue)] text-[#0a0d27]',
}

const TONE_DOT: Record<string, string> = {
  pink: 'bg-[var(--color-brand-pink)]',
  yellow: 'bg-[var(--color-brand-yellow)]',
  green: 'bg-[var(--color-brand-green-bright)]',
  blue: 'bg-[var(--color-brand-blue)]',
}

// Solid brand fill used for the "six tools" hover-sweep + feature aurora.
const TONE_SWEEP: Record<string, string> = {
  pink: 'bg-[var(--color-brand-pink)]',
  yellow: 'bg-[var(--color-brand-yellow)]',
  green: 'bg-[var(--color-brand-green)]',
  blue: 'bg-[var(--color-brand-blue)]',
}

// Ink-on-brand text once a card is swept with its brand color.
const TONE_HOVER_TITLE: Record<string, string> = {
  pink: 'group-hover:text-[#9a0103]',
  yellow: 'group-hover:text-[#441f16]',
  green: 'group-hover:text-[#273416]',
  blue: 'group-hover:text-[#0a0d27]',
}
const TONE_HOVER_BODY: Record<string, string> = {
  pink: 'group-hover:text-[#9a0103cc]',
  yellow: 'group-hover:text-[#441f16cc]',
  green: 'group-hover:text-[#273416cc]',
  blue: 'group-hover:text-[#0a0d27cc]',
}

export default function Home() {
  return (
    <main className="relative isolate min-h-[100dvh] overflow-hidden bg-[var(--color-ink-1)] text-[var(--color-text-1)]">
      <HeroBackdrop />
      <MarketingNav />

      {/* HERO */}
      <section className="relative px-4 pt-28 pb-16 md:px-8 md:pt-32 md:pb-24 lg:px-12">
        <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <ScrollReveal delay={0.05}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-cta-bg)] px-2.5 py-1 text-[12px] font-semibold leading-[1.4286] tracking-[-0.01em] text-[var(--color-brand-pink)]">
                <span className="size-1.5 rounded-full bg-[var(--color-brand-pink)]" />
                New · Agent v2 ships this week
              </span>
            </ScrollReveal>
            <ScrollReveal delay={0.15}>
              <h1
                className="mt-5 text-[clamp(2.75rem,6.2vw,5.75rem)] font-bold leading-[0.95] tracking-[-0.04em] text-[var(--color-text-1)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Autonomous outbound,
                <br />
                <span className="text-[var(--color-text-2)]">for lean teams.</span>
              </h1>
            </ScrollReveal>
            <ScrollReveal delay={0.25}>
              <p className="mt-6 max-w-[520px] text-[18px] leading-[1.5] tracking-[-0.015em] text-[var(--color-text-2)]">
                Quality signals, verified contacts, and email or LinkedIn outreach in one agent that watches, drafts, judges, and sends.
              </p>
            </ScrollReveal>
            <ScrollReveal delay={0.35}>
              <form
                action="/auth/start"
                method="GET"
                className="mt-8 flex w-full max-w-[480px] flex-col gap-3 sm:flex-row sm:items-center"
              >
                <div className="relative flex-1">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]">
                    <Icon name="language" size={16} />
                  </div>
                  <input
                    type="text"
                    name="url"
                    placeholder="yourcompany.com"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9\-_.]*\.[a-zA-Z]{2,}"
                    title="Enter a valid domain like yourcompany.com"
                    className="h-12 w-full rounded-full border border-[var(--color-input-border)] bg-[var(--color-ink-0)] pl-11 pr-4 text-[14px] tracking-[-0.01em] text-[var(--color-text-1)] outline-none transition-colors placeholder:text-[var(--color-text-3)] focus:border-[var(--color-text-1)]"
                  />
                </div>
                <button type="submit" className="btn-solid whitespace-nowrap">
                  Start free
                  <Icon name="arrow_forward" size={15} />
                </button>
              </form>
            </ScrollReveal>
            <ScrollReveal delay={0.45}>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-[var(--color-text-3)]">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-[var(--color-pos)]" />
                  Live in 5 minutes
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-[var(--color-pos)]" />
                  No credit card
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-[var(--color-pos)]" />
                  Cancel anytime
                </span>
              </div>
            </ScrollReveal>
          </div>

          <ScrollReveal delay={0.3}>
            <HeroPane />
          </ScrollReveal>
        </div>
      </section>

      {/* WORKS WITH — honest integrations, not fake social proof */}
      <section className="relative border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-10 md:px-8 lg:px-12">
          <p className="mb-6 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
            Works with the tools you already use
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-14">
            {INTEGRATIONS.map((logo) =>
              logo.slug ? (
                <img
                  key={logo.name}
                  src={`https://cdn.simpleicons.org/${logo.slug}/212121`}
                  alt={logo.name}
                  title={logo.name}
                  width={22}
                  height={22}
                  className="h-[22px] w-auto opacity-50 grayscale transition-opacity hover:opacity-100"
                />
              ) : (
                <svg
                  key={logo.name}
                  role="img"
                  aria-label={logo.name}
                  viewBox="0 0 24 24"
                  width={22}
                  height={22}
                  fill="#212121"
                  className="h-[22px] w-auto opacity-50 transition-opacity hover:opacity-100"
                >
                  <title>{logo.name}</title>
                  <path d={logo.path} />
                </svg>
              ),
            )}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="relative scroll-mt-24 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-8 md:py-28 lg:px-12 lg:py-32">
          <ScrollReveal>
            <div className="max-w-[680px]">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                The stack
              </p>
              <h2
                className="mt-4 text-[clamp(2rem,4.4vw,3.5rem)] font-bold leading-[1.04] tracking-[-0.02em] text-[var(--color-text-1)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Everything you need to fill the pipeline.
              </h2>
              <p className="mt-5 max-w-[540px] text-[17px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-2)]">
                One agent that profiles your company, finds signals, verifies contacts, and runs outreach — all the way through to a reply.
              </p>
            </div>
          </ScrollReveal>

          <div className="mt-12 grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-4">
            {FEATURES.map((feature, i) => (
              <ScrollReveal key={feature.title} delay={i * 0.08}>
                <article className="group relative h-full overflow-hidden rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-7 transition-[transform,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-y-1 hover:border-[var(--color-line-3)] hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.22)]">
                  <div
                    aria-hidden
                    className={`feat-aurora ${i % 2 ? 'feat-aurora-2' : ''} pointer-events-none absolute -right-16 -top-20 size-52 rounded-full opacity-25 blur-[60px] transition-opacity duration-500 group-hover:opacity-60 ${TONE_SWEEP[feature.tone]}`}
                  />
                  <div className="relative">
                    <div className="mb-6 flex items-center justify-between">
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-105 ${TONE_BG[feature.tone]}`}>
                        {feature.tag}
                      </span>
                      <span className="font-mono text-[12px] tabular-nums text-[var(--color-text-4)]">
                        {feature.step}
                      </span>
                    </div>
                    <h3 className="inline-block text-[20px] font-semibold tracking-[-0.015em] text-[var(--color-text-1)]">
                      {feature.title}
                      <span
                        aria-hidden
                        className={`mt-1 block h-[2px] w-0 rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:w-full ${TONE_SWEEP[feature.tone]}`}
                      />
                    </h3>
                    <p className="mt-3 max-w-[42ch] text-[14.5px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-2)]">
                      {feature.description}
                    </p>
                  </div>
                </article>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* STACK GRID */}
      <section id="signals" className="relative scroll-mt-24 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-8 md:py-28 lg:px-12">
          <ScrollReveal>
            <div className="mb-12 max-w-[640px]">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                Replaces six tools
              </p>
              <h2
                className="mt-4 text-[clamp(1.75rem,3.6vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[var(--color-text-1)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                One agent. One bill. One source of truth.
              </h2>
            </div>
          </ScrollReveal>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {STACK.map((card, i) => (
              <ScrollReveal key={card.title} delay={i * 0.05}>
                <div className="group relative h-full overflow-hidden rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 transition-[transform,border-color] duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-y-1 hover:border-transparent hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.22)]">
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute inset-0 translate-y-full transition-transform duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-y-0 ${TONE_SWEEP[card.tone]}`}
                  />
                  <div className="relative">
                    <div className={`mb-4 inline-flex size-10 items-center justify-center rounded-[10px] transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110 group-hover:-rotate-6 group-hover:bg-[var(--color-ink-0)] ${TONE_BG[card.tone]}`}>
                      <Icon name={card.icon} size={18} />
                    </div>
                    <p className={`text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)] transition-colors duration-300 ${TONE_HOVER_TITLE[card.tone]}`}>
                      {card.title}
                    </p>
                    <p className={`mt-1 text-[12.5px] leading-[1.5] tracking-[-0.01em] text-[var(--color-text-3)] transition-colors duration-300 ${TONE_HOVER_BODY[card.tone]}`}>
                      {card.desc}
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* STEPS */}
      <section id="how" className="relative scroll-mt-24 border-t border-[var(--color-line-1)]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-20 md:px-8 md:py-28 lg:px-12 lg:py-32">
          <ScrollReveal>
            <div className="mx-auto mb-16 max-w-[680px] text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                Three minutes
              </p>
              <h2
                className="mt-4 text-[clamp(1.75rem,3.6vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[var(--color-text-1)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Set up. First qualified reply today.
              </h2>
            </div>
          </ScrollReveal>
          <div className="grid gap-12 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => (
              <ScrollReveal key={step.number} delay={i * 0.12}>
                <div className="relative">
                  <span
                    className="text-[80px] font-bold leading-[0.86] tracking-[-0.04em] text-[var(--color-text-1)]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {step.number}
                  </span>
                  <h3 className="mt-4 text-[20px] font-semibold tracking-[-0.015em] text-[var(--color-text-1)]">
                    {step.title}
                  </h3>
                  <p className="mt-2 max-w-[36ch] text-[14.5px] leading-[1.55] tracking-[-0.01em] text-[var(--color-text-2)]">
                    {step.description}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* INVERSE CTA PANEL — Ploy signature */}
      <section className="relative px-4 py-12 md:px-8 md:py-16 lg:px-12">
        <div className="mx-auto w-full max-w-[1280px]">
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-[24px] bg-[var(--color-cta-bg)] px-8 py-16 text-[var(--color-cta-text)] md:px-16 md:py-24 lg:px-20 lg:py-28">
              <div className="relative z-10 mx-auto max-w-[720px] text-center">
                <span className="btn-brand-on-dark tone-green">
                  <Icon name="rocket_launch" size={13} />
                  Launch today
                </span>
                <h2
                  className="mt-6 text-[clamp(2rem,5vw,4rem)] font-bold leading-[0.98] tracking-[-0.04em]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Pipeline that builds itself.
                </h2>
                <p className="mt-6 mx-auto max-w-[440px] text-[16px] leading-[1.55] tracking-[-0.01em] text-[#fff9]">
                  Free to start. No credit card. First buyer profile builds in minutes.
                </p>
                <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href={googleAuthPath('/onboarding')}
                    className="inline-flex h-12 items-center justify-center gap-1.5 rounded-full bg-[var(--color-ink-0)] px-6 text-[14px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)] transition-transform hover:bg-[#f7f7f7] active:scale-[0.98]"
                  >
                    Start free
                    <Icon name="arrow_forward" size={15} />
                  </Link>
                  <a
                    href={FOUNDER_CALL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-on-dark"
                  >
                    Talk to founder
                  </a>
                </div>
              </div>

              {/* Decorative brand pills behind panel */}
              <div aria-hidden className="pointer-events-none absolute -left-8 -top-8 size-44 rounded-full bg-[var(--color-brand-pink)] opacity-20 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute -right-12 bottom-0 size-56 rounded-full bg-[var(--color-brand-green)] opacity-20 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute right-1/3 top-1/2 size-32 rounded-full bg-[var(--color-brand-blue)] opacity-20 blur-3xl" />
            </div>
          </ScrollReveal>
        </div>
      </section>

      <MarketingFooter />
    </main>
  )
}

/**
 * Living hero backdrop — soft brand glows over a faint structural grid.
 * Pure CSS, GPU-friendly, respects prefers-reduced-motion (orbs freeze).
 */
function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[860px] overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(33,33,33,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(33,33,33,0.025) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(120% 70% at 50% 0%, #000 35%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(120% 70% at 50% 0%, #000 35%, transparent 78%)',
        }}
      />
      <div className="animated-bg-orb absolute -left-[12%] -top-[18%] size-[640px] rounded-full bg-[var(--color-brand-pink)] opacity-[0.18] blur-[90px]" />
      <div className="animated-bg-orb absolute right-[-10%] top-[2%] size-[560px] rounded-full bg-[var(--color-brand-blue)] opacity-[0.2] blur-[90px]" style={{ animationDelay: '-7s' }} />
      <div className="animated-bg-orb absolute left-[38%] top-[24%] size-[420px] rounded-full bg-[var(--color-brand-green)] opacity-[0.16] blur-[90px]" style={{ animationDelay: '-14s' }} />
    </div>
  )
}

function HeroPane() {
  return (
    <div className="relative w-full">
      {/* Decorative accent behind pane */}
      <div aria-hidden className="pointer-events-none absolute -inset-x-6 -top-3 -bottom-6 -z-10 rounded-[28px] bg-gradient-to-br from-[var(--color-brand-pink)]/30 via-[var(--color-brand-yellow)]/20 to-[var(--color-brand-blue)]/30" />

      <div className="relative overflow-hidden rounded-[20px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] depth-stack">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-[var(--color-line-1)] px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#ff6157]" />
          <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 inline-flex h-6 flex-1 items-center justify-center rounded-md bg-[var(--color-ink-2)] px-2 text-[11px] text-[var(--color-text-3)]">
            app.bombsell.com / agent
          </span>
        </div>

        {/* App body */}
        <div className="grid grid-cols-[64px_minmax(0,1fr)]">
          {/* Mini sidebar */}
          <div className="flex flex-col items-center gap-3 border-r border-[var(--color-line-1)] bg-[var(--color-ink-1)] py-4">
            {['dashboard', 'auto_awesome', 'person'].map((icon, i) => (
              <span
                key={icon}
                className={
                  'grid size-9 place-items-center rounded-full ' +
                  (i === 1
                    ? 'bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]'
                    : 'text-[var(--color-text-3)] hover:bg-[var(--color-ink-2)]')
                }
              >
                <Icon name={icon} size={16} />
              </span>
            ))}
          </div>

          {/* Main pane */}
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                  Today
                </p>
                <p
                  className="mt-1.5 text-[22px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-text-1)]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  12 qualified signals
                </p>
              </div>
              <span className="btn-brand-on-dark tone-pink">
                <span className="size-1.5 rounded-full bg-[var(--color-brand-pink)] pulse-dot" />
                Live
              </span>
            </div>

            <div className="mt-4 grid gap-2">
              {PROOF_SIGNALS.map((sig) => (
                <div
                  key={sig.kind}
                  className="flex items-center justify-between rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2.5 transition-colors hover:border-[var(--color-line-3)]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`size-2 shrink-0 rounded-full ${TONE_DOT[sig.tone]}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)]">
                        {sig.kind}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--color-text-3)]">
                        {sig.who} · qualified
                      </span>
                    </span>
                  </div>
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-2)]">
                    <Icon name="schedule" size={11} />
                    {sig.when}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniStat label="Sent" value="38" />
              <MiniStat label="Replies" value="6" />
              <MiniStat label="Meetings" value="3" />
            </div>

            <div className="mt-4 flex items-center justify-between rounded-[10px] bg-[var(--color-cta-bg)] px-3.5 py-2.5">
              <span className="text-[12px] font-semibold tracking-[-0.01em] text-[#fff9]">
                Reply rate this week
              </span>
              <span className="text-[14px] font-bold tracking-[-0.01em] text-[var(--color-brand-green-bright)]">
                15.7%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-[var(--color-ink-1)] px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-3)]">
        {label}
      </p>
      <p className="mt-1 text-[18px] font-bold tabular-nums tracking-[-0.02em] text-[var(--color-text-1)]">
        {value}
      </p>
    </div>
  )
}
